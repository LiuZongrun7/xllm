"""
种子数据 —— 让三个端一打开就有东西看

用法（本地 SQLite）
    cd server
    DATABASE_URL=sqlite:///$(pwd)/dev.db ../.venv/bin/python -m shared.seed --reset
    DATABASE_URL=sqlite:///$(pwd)/dev.db ../.venv/bin/python app.py

用法（服务器 MySQL，在 .env 已加载的前提下）
    cd /home/ubuntu/xllm/server
    set -a; . ../.env; set +a
    ../.venv/bin/python -m shared.seed

设计原则
    1. 一套数据贯穿三端：顾客看到的店、商家管的店、骑手要送的店是同一批
    2. 覆盖所有状态，演示时不用现场造数据：pending / accepted / preparing /
       ready（骑手可抢）/ delivering / delivered / cancelled 各有一单
    3. 历史订单跨 14 天，商家端的"营业分析"才有曲线可看
    4. 密码统一 demo1234，README 与登录页都写着这组演示账号
"""

from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta
from decimal import Decimal

from shared.catalog import cuisine_emoji
from shared.extensions import db
from shared.models import (CustomerAddress, MenuItem, OpeningHour, Order,
                           OrderItem, Restaurant, Review, RiderLocation,
                           RiderProfile, User)
from shared.order_flow import haversine_km

DEMO_PASSWORD = "demo1234"

# 上海人民广场一带的真实坐标，高德地图上能落在正确位置
ADDR_ALEX = ("Home", "Alex Chen", "13800000001",
             "Room 1203, 88 Xizang Middle Road, Huangpu, Shanghai",
             121.4815000, 31.2330000)
ADDR_MIA = ("Office", "Mia Wang", "13800000002",
            "18F, 268 Wuning Road, Putuo, Shanghai",
            121.4230000, 31.2380000)

RESTAURANTS = [
    {
        "owner": ("goldenwok", "Lin Tao", "merchant1@xllm.cloud", "13600000001"),
        "name": "Golden Wok Kitchen",
        "phone": "021-5566-8801",
        "address": "126 Nanjing East Road, Huangpu, Shanghai",
        "lng": 121.4737000, "lat": 31.2304000,
        "cuisine": "Chinese",
        "description": "Cantonese wok classics, fired to order. Family recipes since 1998.",
        "min_order": 20, "fee": 5, "radius": 5, "capacity": 20, "prep": 18,
        "is_open": True,
        "hours": ("10:00", "22:00"),
        "menu": [
            ("Starters", "Crispy Spring Rolls (4 pcs)", 12, 260, 40, "Hand-rolled, vegetable filling"),
            ("Starters", "Pork & Chive Dumplings (6 pcs)", 18, 380, 24, "Steamed, black vinegar dip"),
            ("Starters", "Hot & Sour Soup", 14, 120, None, "White pepper, tofu, bamboo shoot"),
            ("Mains", "Teriyaki Chicken Bowl", 26, 640, 34, "Grilled thigh, jasmine rice, sesame"),
            ("Mains", "Kung Pao Chicken", 32, 720, 3, "Dried chilli, roasted peanuts"),
            ("Mains", "Mapo Tofu", 24, 430, None, "Sichuan peppercorn, minced pork"),
            ("Mains", "Sweet & Sour Pork", 30, 680, 12, "Pineapple, bell pepper, light batter"),
            ("Mains", "Beef Fried Rice", 28, 610, 0, "Wok-tossed, spring onion, egg"),
            ("Drinks", "Iced Lemon Tea", 8, 90, None, "Brewed daily, no powder"),
            ("Desserts", "Mango Pudding", 12, 210, 9, "Fresh mango, coconut milk"),
        ],
    },
    {
        "owner": ("noodlebar", "Zhou Lan", "merchant2@xllm.cloud", "13600000002"),
        "name": "Noodle Bar",
        "phone": "021-5566-8802",
        "address": "45 Yunnan South Road, Huangpu, Shanghai",
        "lng": 121.4620000, "lat": 31.2255000,
        "cuisine": "Noodles",
        "description": "Hand-pulled noodles and a broth that simmers for eight hours.",
        "min_order": 15, "fee": 4, "radius": 4, "capacity": 12, "prep": 15,
        "is_open": True,
        "hours": ("11:00", "21:00"),
        "menu": [
            ("Noodles", "Beef Noodle Soup", 32, 690, 18, "Braised shank, star anise broth"),
            ("Noodles", "Spicy Dan Dan Noodles", 26, 620, 22, "Sesame paste, chilli oil, pork crumb"),
            ("Noodles", "Wonton Noodles", 24, 540, 4, "Prawn wontons, spring onion"),
            ("Noodles", "Scallion Oil Noodles", 18, 480, None, "Simple, fragrant, vegetarian"),
            ("Sides", "Cucumber Salad", 10, 80, None, "Chilled, garlic, black vinegar"),
            ("Sides", "Braised Egg", 4, 70, None, "Marinated overnight"),
            ("Drinks", "Soy Milk", 6, 110, None, "Unsweetened, served warm"),
            ("Drinks", "Plum Juice", 8, 130, 16, "Sour plum, rock sugar"),
        ],
    },
    {
        "owner": ("sakura", "Haruka Sato", "merchant3@xllm.cloud", "13600000003"),
        "name": "Sakura Sushi House",
        "phone": "021-5566-8803",
        "address": "9 Madang Road, Huangpu, Shanghai",
        "lng": 121.4855000, "lat": 31.2360000,
        "cuisine": "Japanese",
        "description": "Counter-style nigiri, cut to order. Limited seats, limited rice.",
        "min_order": 30, "fee": 6, "radius": 6, "capacity": 25, "prep": 22,
        "is_open": True,
        "hours": ("11:30", "22:30"),
        "menu": [
            ("Sushi", "Salmon Nigiri (4 pcs)", 28, 320, 20, "Norwegian salmon, aged rice"),
            ("Sushi", "Tuna Roll (8 pcs)", 32, 410, 14, "Bluefin akami, nori"),
            ("Sushi", "California Roll (8 pcs)", 26, 430, None, "Crab stick, avocado, roe"),
            ("Sushi", "Sashimi Platter", 68, 380, 5, "Chef's selection, 12 slices"),
            ("Sides", "Edamame", 12, 130, None, "Sea salt"),
            ("Sides", "Miso Soup", 8, 60, None, "Wakame, silken tofu"),
            ("Sides", "Chawanmushi", 16, 140, 7, "Steamed egg custard, prawn"),
            ("Drinks", "Cold Green Tea", 6, 0, None, "Genmaicha, unsweetened"),
            ("Desserts", "Matcha Ice Cream", 14, 240, 11, "Uji matcha"),
        ],
    },
    {
        "owner": ("greenbowl", "Emma Liu", "merchant4@xllm.cloud", "13600000004"),
        "name": "Green Bowl Salad",
        "phone": "021-5566-8804",
        "address": "77 Wuding Road, Jing'an, Shanghai",
        "lng": 121.4520000, "lat": 31.2410000,
        "cuisine": "Salad",
        "description": "Grain bowls and cold-pressed juice. Closed on Sundays.",
        "min_order": 25, "fee": 5, "radius": 4, "capacity": 10, "prep": 12,
        "is_open": False,          # 演示"店家打烊"这种状态
        "hours": ("10:00", "20:00"),
        "menu": [
            ("Salad", "Grilled Chicken Caesar", 32, 450, 15, "Romaine, parmesan, sourdough croutons"),
            ("Salad", "Avocado Quinoa Bowl", 36, 520, 9, "Cherry tomato, edamame, lemon dressing"),
            ("Salad", "Smoked Salmon Bowl", 42, 480, 6, "Cream cheese, capers, rye"),
            ("Drinks", "Cold-pressed Orange", 16, 120, None, "No added sugar"),
            ("Drinks", "Green Detox Juice", 18, 90, None, "Kale, cucumber, apple, ginger"),
        ],
    },
]

RIDERS = [
    ("chen", "Chen Wei", "rider1@xllm.cloud", "13900000001", "ebike", True),
    ("zhao", "Zhao Min", "rider2@xllm.cloud", "13900000002", "motorbike", True),
    ("liu", "Liu Fang", "rider3@xllm.cloud", "13900000003", "bike", False),
]

CUSTOMERS = [
    ("alex", "Alex Chen", "customer1@xllm.cloud", "13800000001"),
    ("mia", "Mia Wang", "customer2@xllm.cloud", "13800000002"),
]

REVIEW_LINES = [
    "Arrived hot and earlier than expected. The dumplings were the highlight.",
    "Portion was generous. Packaging could be a little tighter for the soup.",
    "Exactly as described. Second order this month, will come back.",
    "Good value. The rice was slightly dry but the chicken made up for it.",
    "Rider was quick and polite. Food still steaming when it arrived.",
]


# ---------------------------------------------------------------------------
#  构造工具
# ---------------------------------------------------------------------------
def _user(role: str, username: str, name: str, email: str, phone: str) -> User:
    user = User(role=role, username=username, email=email, name=name,
                phone=phone, email_verified_at=datetime.now())
    user.set_password(DEMO_PASSWORD)
    db.session.add(user)
    db.session.flush()          # 马上要拿 user.id 建关联行
    return user


def _menu_rows(restaurant: Restaurant, rows) -> list[MenuItem]:
    items = []
    for index, (category, name, price, calories, stock, description) in enumerate(rows):
        item = MenuItem(
            restaurant_id=restaurant.id,
            name=name,
            description=description,
            price=Decimal(str(price)),
            calories=calories,
            category=category,
            stock=stock,
            is_available=True,
            sort_order=index,
        )
        db.session.add(item)
        items.append(item)
    return items


def _address(customer: User, spec, is_default: bool = True) -> CustomerAddress:
    label, name, phone, text, lng, lat = spec
    address = CustomerAddress(
        user_id=customer.id, label=label, contact_name=name, contact_phone=phone,
        address_text=text, lng=Decimal(str(lng)), lat=Decimal(str(lat)),
        is_default=is_default,
    )
    db.session.add(address)
    return address


def _order(customer: User, restaurant: Restaurant, address: CustomerAddress,
           lines, status: str, created: datetime, rider: User | None = None,
           rating: int | None = None, remark: str | None = None,
           delay: bool = False, order_no: str | None = None) -> Order:
    """按目标状态把时间戳一次性铺好 —— 种子数据要看起来像真的跑过一遍"""
    distance = haversine_km(float(restaurant.lat), float(restaurant.lng),
                            float(address.lat), float(address.lng))
    items_amount = sum(float(item.price) * qty for item, qty in lines)
    fee = float(restaurant.delivery_fee)
    total = round(items_amount + fee, 2)

    order = Order(
        order_no=order_no or "XLM-{}-{}".format(
            created.strftime("%y%m%d"), f"{random.randint(0, 0xFFFF):04X}"),
        customer_id=customer.id,
        restaurant_id=restaurant.id,
        rider_id=rider.id if rider else None,
        status=status,
        payment_status="paid" if status != "cancelled" else "refunded",
        delivery_address_text=address.address_text,
        delivery_lng=address.lng,
        delivery_lat=address.lat,
        delivery_contact_name=address.contact_name,
        delivery_contact_phone=address.contact_phone,
        items_amount=Decimal(str(round(items_amount, 2))),
        delivery_fee=Decimal(str(fee)),
        discount_amount=Decimal("0.00"),
        total_amount=Decimal(str(total)),
        distance_km=Decimal(str(distance)),
        estimated_delivery_at=created + timedelta(
            minutes=int(restaurant.avg_prep_minutes) + max(int(distance / 18 * 60), 5)),
        remark=remark,
        created_at=created,
    )
    if delay:
        order.delay_flagged_at = created + timedelta(minutes=25)
        order.delay_reason = "Kitchen is running behind"

    stamps = {
        "accepted": created + timedelta(minutes=2),
        "preparing": created + timedelta(minutes=4),
        "ready": created + timedelta(minutes=int(restaurant.avg_prep_minutes)),
        "delivering": created + timedelta(minutes=int(restaurant.avg_prep_minutes) + 5),
        "delivered": created + timedelta(minutes=int(restaurant.avg_prep_minutes) + 22),
    }
    order.accepted_at = stamps["accepted"] if status in (
        "accepted", "preparing", "ready", "delivering", "delivered") else None
    order.preparing_at = stamps["preparing"] if status in (
        "preparing", "ready", "delivering", "delivered") else None
    order.ready_at = stamps["ready"] if status in (
        "ready", "delivering", "delivered") else None
    order.picked_up_at = stamps["delivering"] if status in (
        "delivering", "delivered") else None
    order.delivered_at = stamps["delivered"] if status == "delivered" else None
    if status == "cancelled":
        order.cancelled_at = created + timedelta(minutes=6)
        order.cancelled_by = "customer"
        order.cancel_reason = "Changed my mind"

    db.session.add(order)
    db.session.flush()          # 需要 order.id 才能挂明细

    for item, qty in lines:
        db.session.add(OrderItem(
            order_id=order.id, menu_item_id=item.id,
            name_snapshot=item.name, unit_price=item.price,
            quantity=qty, subtotal=Decimal(str(round(float(item.price) * qty, 2))),
        ))

    if rating and status == "delivered":
        db.session.add(Review(
            order_id=order.id, reviewer_id=customer.id,
            target_type="restaurant", target_id=restaurant.id,
            rating=rating, content=random.choice(REVIEW_LINES),
        ))
        if rider:
            db.session.add(Review(
                order_id=order.id, reviewer_id=customer.id,
                target_type="rider", target_id=rider.id,
                rating=min(5, rating + (1 if rating < 5 else 0)),
                content="Rider handled the handover well.",
            ))
    return order


def _location(rider: User, order: Order, minutes_ago: int = 3):
    """给配送中的订单补一条位置记录，顾客端"骑手位置"才有数据"""
    when = datetime.now() - timedelta(minutes=minutes_ago)
    db.session.add(RiderLocation(
        rider_id=rider.id, order_id=order.id,
        lng=Decimal(str(121.4800000)), lat=Decimal(str(31.2340000)),
        accuracy_m=12, recorded_at=when,
    ))


# ---------------------------------------------------------------------------
#  主流程
# ---------------------------------------------------------------------------
def seed(reset: bool = False) -> None:
    if reset:
        db.drop_all()
    db.create_all()

    if User.query.first() is not None:
        print("[seed] database already has users — nothing to do "
              "(use --reset to rebuild)")
        return

    random.seed(20261022)

    customers = [_user("customer", *row) for row in CUSTOMERS]
    alex, mia = customers
    address_alex = _address(alex, ADDR_ALEX)
    _address(mia, ADDR_MIA)

    riders = []
    for username, name, email, phone, vehicle, online in RIDERS:
        rider = _user("rider", username, name, email, phone)
        db.session.flush()
        db.session.add(RiderProfile(
            user_id=rider.id, is_online=online, vehicle_type=vehicle,
            service_radius_km=Decimal("6.00"),
        ))
        riders.append(rider)
    chen, zhao, liu = riders

    restaurants = []
    menus = []
    for spec in RESTAURANTS:
        username, owner_name, email, phone = spec["owner"]
        owner = _user("restaurant", username, owner_name, email, phone)
        db.session.flush()
        restaurant = Restaurant(
            owner_id=owner.id,
            name=spec["name"],
            phone=spec["phone"],
            address_text=spec["address"],
            lng=Decimal(str(spec["lng"])),
            lat=Decimal(str(spec["lat"])),
            description=spec["description"],
            cuisine=spec["cuisine"],
            min_order_amount=Decimal(str(spec["min_order"])),
            delivery_fee=Decimal(str(spec["fee"])),
            delivery_radius_km=Decimal(str(spec["radius"])),
            max_concurrent_orders=spec["capacity"],
            avg_prep_minutes=spec["prep"],
            is_open=spec["is_open"],
        )
        db.session.add(restaurant)
        db.session.flush()

        open_at, close_at = spec["hours"]
        for weekday in range(1, 8):
            closed = spec["name"].startswith("Green Bowl") and weekday == 7
            db.session.add(OpeningHour(
                restaurant_id=restaurant.id, weekday=weekday,
                open_time=datetime.strptime(open_at, "%H:%M").time(),
                close_time=datetime.strptime(close_at, "%H:%M").time(),
                is_closed=closed,
            ))

        menus.append(_menu_rows(restaurant, spec["menu"]))
        restaurants.append(restaurant)

    db.session.flush()
    golden, noodle, sushi, green = restaurants
    golden_menu, noodle_menu, sushi_menu, _ = menus
    now = datetime.now()

    # ---- 活跃订单：覆盖每一种"进行中"的状态 ----
    _order(alex, golden, address_alex,
           [(golden_menu[3], 1), (golden_menu[1], 1), (golden_menu[8], 2)],
           "pending", now - timedelta(minutes=3),
           remark="No cutlery please, thanks.")

    _order(mia, noodle, address_alex,
           [(noodle_menu[0], 1), (noodle_menu[4], 1)],
           "accepted", now - timedelta(minutes=8))

    _order(alex, golden, address_alex,
           [(golden_menu[4], 1), (golden_menu[7], 1)],
           "preparing", now - timedelta(minutes=12), delay=False)

    # ready + 没有骑手 → 骑手端"可接单池"里能直接抢
    _order(mia, golden, address_alex,
           [(golden_menu[2], 2), (golden_menu[9], 1)],
           "ready", now - timedelta(minutes=24))

    delivering = _order(alex, sushi, address_alex,
                        [(sushi_menu[0], 2), (sushi_menu[5], 1)],
                        "delivering", now - timedelta(minutes=30), rider=chen)
    _location(chen, delivering, minutes_ago=2)

    # ---- 已完成 / 已取消 ----
    _order(mia, sushi, address_alex,
           [(sushi_menu[2], 1), (sushi_menu[8], 1)],
           "delivered", now - timedelta(hours=5), rider=zhao, rating=5)

    _order(alex, noodle, address_alex,
           [(noodle_menu[1], 1), (noodle_menu[6], 2)],
           "cancelled", now - timedelta(hours=9))

    # ---- 过去 14 天的历史单：商家端"营业分析"要有曲线 ----
    all_menus = [golden_menu, noodle_menu, sushi_menu]
    for day in range(1, 15):
        for index, restaurant in enumerate((golden, noodle, sushi)):
            count = random.choice((0, 1, 2, 3))
            for n in range(count):
                created = now - timedelta(days=day, hours=random.randint(0, 6),
                                          minutes=random.randint(0, 59))
                menu = all_menus[index]
                picks = random.sample(menu, k=min(2, len(menu)))
                lines = [(item, random.randint(1, 2)) for item in picks]
                cancelled = random.random() < 0.08
                _order(random.choice((alex, mia)), restaurant, address_alex, lines,
                       "cancelled" if cancelled else "delivered", created,
                       rider=random.choice((chen, zhao, liu)),
                       rating=None if cancelled else random.choice((4, 4, 5, 5, 3)))

    db.session.commit()

    print("[seed] done")
    print(f"[seed]   users       {User.query.count()}")
    print(f"[seed]   restaurants {Restaurant.query.count()}")
    print(f"[seed]   menu items  {MenuItem.query.count()}")
    print(f"[seed]   orders      {Order.query.count()}")
    print(f"[seed]   reviews     {Review.query.count()}")
    print("[seed] demo accounts (password: %s)" % DEMO_PASSWORD)
    print("[seed]   customer  alex / customer1@xllm.cloud")
    print("[seed]   merchant  goldenwok / merchant1@xllm.cloud")
    print("[seed]   rider     chen / rider1@xllm.cloud")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the xLLM demo dataset")
    parser.add_argument("--reset", action="store_true",
                        help="drop all tables first (destroys existing data!)")
    args = parser.parse_args()

    from app import create_app            # 延迟 import：需要 config 已经生效
    app = create_app()
    with app.app_context():
        seed(reset=args.reset)


if __name__ == "__main__":
    main()
