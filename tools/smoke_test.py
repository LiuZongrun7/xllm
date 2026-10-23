"""
端到端冒烟测试 —— 一条命令验完整个订单链路

用法
    cd server
    DATABASE_URL=sqlite:////tmp/xllm-smoke.db ../.venv/bin/python ../tools/smoke_test.py

它会：
    1. 重建一个临时库并灌入种子数据（不会碰你的 dev.db / 线上库）
    2. 用 Flask 的 test_client 依次扮演顾客 / 商家 / 骑手
    3. 跑完 下单 → 接单 → 备餐 → 待取 → 抢单 → 取餐 → 送达 → 评价
    4. 顺带验证越权、库存、取消窗口、抢单竞态、GPS 校验这些容易漏的点

⚠️ 用 DATABASE_URL 指到临时库再跑。指到线上库会清空数据。
"""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER_DIR))
os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/xllm-smoke.db")

from app import create_app                       # noqa: E402
from shared.extensions import db                 # noqa: E402
from shared.seed import seed                     # noqa: E402

PASSWORD = "demo1234"
PASSED = 0
FAILED: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL {label}  {detail}")


def call(client, method: str, path: str, payload: dict | None = None):
    response = getattr(client, method)(path, json=payload) if payload is not None \
        else getattr(client, method)(path)
    try:
        body = response.get_json()
    except Exception:
        body = None
    return response.status_code, body or {}


def login(account: str):
    client = app.test_client()
    status, body = call(client, "post", "/api/auth/login",
                        {"account": account, "password": PASSWORD})
    assert status == 200 and body.get("ok"), f"login failed for {account}: {body}"
    return client


def main() -> int:
    global app
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        db.drop_all()
        db.create_all()
        seed()

    print("\n=== auth ===")
    customer = login("alex")
    status, body = call(customer, "post", "/api/auth/login",
                        {"account": "alex", "password": "wrong-password"})
    check("wrong password is rejected", status == 401, body)
    anon = app.test_client()
    status, body = call(anon, "get", "/api/auth/me")
    check("anonymous /me is 401", status == 401, body)
    status, body = call(anon, "get", "/api/customer/orders")
    check("anonymous orders API is 401", status == 401, body)

    print("\n=== browsing ===")
    status, body = call(customer, "get", "/api/customer/restaurants")
    cards = body["data"]["restaurants"]
    check("restaurant list returns 4 stores", len(cards) == 4, len(cards))
    distances = [c["distance_km"] for c in cards]
    check("sorted by distance", distances == sorted(distances), distances)
    check("every card has open state", all("state" in c for c in cards))
    golden = next(c for c in cards if c["name"] == "Golden Wok Kitchen")
    green = next(c for c in cards if c["name"] == "Green Bowl Salad")
    check("paused store is not accepting", green["state"]["accepting"] is False)
    check("paused store says why", green["state"]["reason"] == "paused",
          green["state"])

    status, body = call(customer, "get", f"/api/customer/restaurants/{golden['id']}")
    detail = body["data"]
    check("detail returns grouped menu", len(detail["menu"]) >= 3)
    check("within delivery radius", detail["within_radius"] is True)

    status, body = call(customer, "get", "/api/customer/search?q=noodle")
    check("search finds restaurants and dishes",
          len(body["data"]["restaurants"]) + len(body["data"]["dishes"]) > 0)

    print("\n=== addresses ===")
    status, body = call(customer, "get", "/api/customer/addresses")
    address = body["data"]["addresses"][0]
    status, body = call(customer, "post", "/api/customer/addresses", {
        "label": "Office", "contact_name": "Alex Chen",
        "contact_phone": "13800000001",
        "address_text": "18F, 268 Wuning Road, Putuo, Shanghai",
        "lng": 121.4230, "lat": 31.2380,
    })
    check("create address", status == 201, body)
    second_address = body["data"]
    status, body = call(customer, "delete",
                        f"/api/customer/addresses/{address['id']}")
    check("default address cannot be deleted", status == 400, body)
    status, body = call(customer, "delete",
                        f"/api/customer/addresses/{second_address['id']}")
    check("non-default address can be deleted", status == 200, body)

    print("\n=== ordering rules ===")
    menu_items = [item for group in detail["menu"] for item in group["items"]]
    cheap = sorted([i for i in menu_items if not i["sold_out"]],
                   key=lambda i: i["price"])[0]
    status, body = call(customer, "post", "/api/customer/orders", {
        "restaurant_id": golden["id"], "address_id": address["id"],
        "items": [{"menu_item_id": cheap["id"], "quantity": 1}],
    })
    check("minimum order is enforced", status == 409, body)

    status, body = call(customer, "post", "/api/customer/orders", {
        "restaurant_id": green["id"], "address_id": address["id"],
        "items": [{"menu_item_id": 999999, "quantity": 1}],
    })
    check("paused store rejects orders", status == 409, body)

    pizza = [i for i in menu_items if i["sold_out"]]
    check("seed contains a sold-out dish to test", bool(pizza))
    if pizza:
        status, body = call(customer, "post", "/api/customer/orders", {
            "restaurant_id": golden["id"], "address_id": address["id"],
            "items": [{"menu_item_id": pizza[0]["id"], "quantity": 1}],
        })
        check("sold-out dish is rejected", status == 409, body)

    print("\n=== place order ===")
    picks = [i for i in menu_items if not i["sold_out"]][:2]
    want = {i["id"]: 2 for i in picks}
    status, body = call(customer, "post", "/api/customer/orders", {
        "restaurant_id": golden["id"], "address_id": address["id"],
        "items": [{"menu_item_id": k, "quantity": v} for k, v in want.items()],
        "remark": "Extra napkins",
    })
    check("order placed", status == 201, body)
    order = body["data"]["order"]
    order_id = order["id"]
    expected = round(sum(i["price"] * 2 for i in picks) + golden["delivery_fee"], 2)
    check("total = items + delivery fee", abs(order["total_amount"] - expected) < 0.01,
          (order["total_amount"], expected))

    status, body = call(customer, "get", f"/api/customer/restaurants/{golden['id']}")
    after = {i["id"]: i for group in body["data"]["menu"] for i in group["items"]}
    for item in picks:
        before_stock, after_stock = item["stock"], after[item["id"]]["stock"]
        if before_stock is not None:
            check(f"stock decreased for {item['name']}",
                  after_stock == before_stock - 2, (before_stock, after_stock))

    print("\n=== changing the delivery address (FR-19) ===")
    status, body = call(customer, "post", "/api/customer/addresses", {
        "label": "Parents", "contact_name": "Alex Chen",
        "contact_phone": "13800000001",
        "address_text": "18F, 268 Wuning Road, Putuo, Shanghai",
        "lng": 121.4230, "lat": 31.2380, "is_default": False,
    })
    new_address = body["data"]
    status, body = call(customer, "post", f"/api/customer/orders/{order_id}/address",
                        {"address_id": new_address["id"]})
    check("customer changes the delivery address", status == 200, body)
    updated = body["data"]["order"] if body.get("ok") else {}
    check("distance is recalculated",
          updated.get("distance_km") != order["distance_km"],
          (updated.get("distance_km"), order["distance_km"]))
    check("address change is stamped", updated.get("address_updated_at") is not None)
    status, body = call(customer, "get", f"/api/customer/orders/{order_id}")
    check("the new address is stored on the order",
          body["data"]["delivery"]["address_text"] == new_address["address_text"])

    print("\n=== merchant side ===")
    merchant = login("goldenwok")
    noodle_merchant = login("noodlebar")
    status, body = call(merchant, "get", f"/api/merchant/orders/{order_id}")
    check("merchant sees its own order", status == 200, body)
    status, body = call(noodle_merchant, "get", f"/api/merchant/orders/{order_id}")
    check("other merchant cannot read the order (IDOR)", status == 404, body)

    status, body = call(merchant, "get", "/api/merchant/dashboard")
    check("dashboard exposes kpis and queue",
          "kpis" in body["data"] and "counts" in body["data"]["queue"])

    status, body = call(customer, "post", f"/api/merchant/orders/{order_id}/accept")
    check("customer cannot accept an order", status == 403, body)

    for action, label in (("accept", "merchant accepts"),
                          ("preparing", "merchant starts preparing"),
                          ("ready", "merchant marks ready")):
        status, body = call(merchant, "post", f"/api/merchant/orders/{order_id}/{action}")
        check(label, status == 200, body)

    status, body = call(merchant, "post", f"/api/merchant/orders/{order_id}/accept")
    check("repeating accept is rejected", status == 409, body)

    status, body = call(customer, "post", f"/api/customer/orders/{order_id}/cancel",
                        {"reason": "Too slow"})
    check("customer cannot cancel while preparing", status == 409, body)

    status, body = call(merchant, "post", f"/api/merchant/orders/{order_id}/delay",
                        {"reason": "Wok is backed up"})
    check("merchant flags a delay", status == 200, body)
    status, body = call(customer, "get", f"/api/customer/orders/{order_id}")
    check("customer sees the delay", body["data"]["is_delayed"] is True)

    print("\n=== rider side ===")
    rider = login("chen")
    call(rider, "post", "/api/rider/status", {"is_online": False})
    status, body = call(rider, "post", f"/api/rider/orders/{order_id}/claim")
    check("offline rider cannot claim", status == 409, body)

    call(rider, "post", "/api/rider/status", {"is_online": True})
    status, body = call(rider, "get", "/api/rider/pool")
    check("order appears in the pool",
          any(o["id"] == order_id for o in body["data"]["orders"]))

    other_rider = login("zhao")
    call(other_rider, "post", "/api/rider/status", {"is_online": True})
    status, body = call(rider, "post", f"/api/rider/orders/{order_id}/claim")
    check("first rider claims the order", status == 200, body)
    status, body = call(other_rider, "post", f"/api/rider/orders/{order_id}/claim")
    check("second rider cannot claim it (atomic)", status == 409, body)

    status, body = call(other_rider, "post", f"/api/rider/orders/{order_id}/pickup")
    check("other rider cannot pick it up", status == 404, body)

    status, body = call(rider, "post", f"/api/rider/orders/{order_id}/pickup")
    check("rider picks up", status == 200, body)

    status, body = call(rider, "post", f"/api/rider/orders/{order_id}/location",
                        {"lng": 121.478, "lat": 31.234, "accuracy_m": 10})
    check("rider reports a location", status == 200, body)
    status, body = call(rider, "post", f"/api/rider/orders/{order_id}/location",
                        {"lng": 121.478, "lat": 31.234, "accuracy_m": 500})
    check("weak GPS accuracy is rejected", status == 422, body)
    status, body = call(rider, "post", f"/api/rider/orders/{order_id}/location",
                        {"lng": 122.9, "lat": 32.9, "accuracy_m": 10})
    check("impossible jump is rejected", status == 422, body)

    status, body = call(rider, "post", f"/api/rider/orders/{order_id}/deliver")
    check("rider confirms delivery", status == 200, body)

    status, body = call(customer, "post", f"/api/customer/orders/{order_id}/address",
                        {"address_id": new_address["id"]})
    check("address cannot change after pickup", status == 409, body)

    print("\n=== customer after delivery ===")
    status, body = call(customer, "get", f"/api/customer/orders/{order_id}")
    order = body["data"]
    check("status is delivered", order["status"] == "delivered")
    check("all timeline steps are done",
          all(step["state"] == "done" for step in order["steps"]),
          [(s["label"], s["state"]) for s in order["steps"]])
    check("review is offered", order["can_review"] is True)

    status, body = call(customer, "post", f"/api/customer/orders/{order_id}/review",
                        {"restaurant_rating": 5, "rider_rating": 4,
                         "content": "Hot and on time"})
    check("customer reviews the order", status == 200, body)
    status, body = call(customer, "post", f"/api/customer/orders/{order_id}/review",
                        {"restaurant_rating": 4})
    check("second review is rejected", status == 409, body)

    another_customer = login("mia")
    status, body = call(another_customer, "get", f"/api/customer/orders/{order_id}")
    check("other customer cannot read the order (IDOR)", status == 404, body)

    print("\n=== cancellation window ===")
    fresh = call(customer, "post", "/api/customer/orders", {
        "restaurant_id": golden["id"], "address_id": address["id"],
        "items": [{"menu_item_id": picks[0]["id"], "quantity": 2}],
    })[1]["data"]["order"]
    status, body = call(customer, "post", f"/api/customer/orders/{fresh['id']}/cancel",
                        {"reason": "Ordered by mistake"})
    check("customer cancels a pending order", status == 200, body)
    check("cancelled order is refunded",
          body["data"]["order"]["payment_status"] == "refunded")

    print("\n=== merchant menu management ===")
    status, body = call(merchant, "post", "/api/merchant/menu-items", {
        "name": "Smoke Test Special", "price": 19.5, "category": "Specials",
        "calories": 500, "stock": 10,
    })
    check("create a dish", status == 201, body)
    item_id = body["data"]["item"]["id"]
    status, body = call(merchant, "patch", f"/api/merchant/menu-items/{item_id}/stock",
                        {"stock": 2})
    check("stock update marks low stock",
          body["data"]["item"]["stock_state"] == "low_stock", body)
    status, body = call(merchant, "post", "/api/merchant/menu-items/restock",
                        {"threshold": 5, "amount": 20})
    check("restock restores low-stock dishes", body["data"]["updated"] >= 1, body)
    status, body = call(merchant, "patch", f"/api/merchant/menu-items/{item_id}",
                        {"price": 21.0, "is_available": False})
    check("patch a dish", status == 200 and body["data"]["item"]["sold_out"] is True,
          body)
    status, body = call(merchant, "delete", f"/api/merchant/menu-items/{item_id}")
    check("delete a dish", status == 200, body)
    status, body = call(noodle_merchant, "patch",
                        f"/api/merchant/menu-items/{item_id}", {"price": 1})
    check("other merchant cannot edit the dish (IDOR)", status == 404, body)

    print("\n=== settings / analytics / issues ===")
    status, body = call(merchant, "put", "/api/merchant/settings", {
        "is_open": True, "max_concurrent_orders": 25, "avg_prep_minutes": 20,
        "delivery_radius_km": 6.0, "min_order_amount": 18.0, "delivery_fee": 4.5,
        "opening_hours": [{"weekday": d, "open_time": "09:30",
                           "close_time": "22:30", "is_closed": d == 7}
                          for d in range(1, 8)],
    })
    check("save settings", status == 200, body)
    check("capacity saved",
          body["data"]["restaurant"]["max_concurrent_orders"] == 25)
    check("opening hours saved",
          body["data"]["opening_hours"][6]["is_closed"] is True)

    status, body = call(merchant, "get", "/api/merchant/analytics?days=14")
    data = body["data"]
    check("analytics returns 14 daily points", len(data["daily"]) == 14)
    check("analytics has top items", len(data["top_items"]) > 0)
    check("analytics has hourly buckets", len(data["hourly"]) == 24)

    status, body = call(merchant, "get", "/api/merchant/issues")
    check("issues endpoint responds", status == 200 and "issues" in body["data"])

    print("\n=== rider history / profile ===")
    status, body = call(rider, "get", "/api/rider/history")
    check("delivered order is in rider history",
          any(o["id"] == order_id for o in body["data"]["orders"]))
    status, body = call(rider, "patch", "/api/rider/profile",
                        {"vehicle_type": "motorbike", "service_radius_km": 8})
    check("update rider profile", status == 200, body)
    status, body = call(rider, "patch", "/api/rider/profile", {"vehicle_type": "boat"})
    check("invalid vehicle is rejected", status == 400, body)

    print("\n=== public site (/info) ===")
    landing = anon.get("/")
    check("root redirects to the public site",
          landing.status_code == 302 and landing.headers["Location"] == "/info/",
          f"{landing.status_code} {landing.headers.get('Location')}")

    info = anon.get("/info/")
    info_html = info.get_data(as_text=True)
    check("GET /info/ → 200", info.status_code == 200, info.status_code)
    check("public site links all three apps",
          all(path in info_html for path in ("/customer/login", "/merchant/login", "/rider/login")))
    check("public site is self-contained (no external assets)",
          "http://" not in info_html.replace("http://www.w3.org", "")
          and "https://" not in info_html.replace("https://github.com", ""))

    short = anon.get("/info")
    check("GET /info redirects to /info/",
          short.status_code in (301, 308), short.status_code)

    demo = anon.get("/info/demo")
    check("/info/demo points at the demo section",
          demo.status_code == 302 and demo.headers["Location"].endswith("#demo"),
          f"{demo.status_code} {demo.headers.get('Location')}")

    css = anon.get("/info/static/css/info.css")
    check("public site stylesheet is served", css.status_code == 200, css.status_code)

    missing = anon.get("/no-such-page")
    check("unknown paths get the branded 404",
          missing.status_code == 404 and "Nothing here." in missing.get_data(as_text=True),
          missing.status_code)

    print("\n=== pages render ===")
    pages = [
        (anon, "/customer/login", 200),
        (anon, "/customer/register", 200),
        (anon, "/merchant/login", 200),
        (anon, "/rider/login", 200),
        (anon, "/customer/design-system", 200),
        (anon, "/merchant/design-system", 200),
        (anon, "/rider/design-system", 200),
        (anon, "/customer/", 302),
        (customer, "/customer/", 200),
        (customer, "/customer/orders", 200),
        (customer, f"/customer/orders/{order_id}", 200),
        (customer, "/customer/cart", 200),
        (customer, "/customer/checkout", 200),
        (customer, "/customer/addresses", 200),
        (customer, "/customer/account", 200),
        (customer, "/customer/search", 200),
        (merchant, "/merchant/", 200),
        (merchant, "/merchant/orders", 200),
        (merchant, f"/merchant/orders/{order_id}", 200),
        (merchant, "/merchant/menu", 200),
        (merchant, "/merchant/settings", 200),
        (merchant, "/merchant/analytics", 200),
        (merchant, "/merchant/issues", 200),
        (rider, "/rider/", 200),
        (rider, f"/rider/orders/{order_id}", 200),
        (rider, "/rider/history", 200),
        (rider, "/rider/settings", 200),
    ]
    for client, path, expected in pages:
        try:
            status, _ = call(client, "get", path)
            detail = f"got {status}"
        except Exception as exc:                     # 模板缺失 / Jinja 报错
            status, detail = None, f"{type(exc).__name__}: {exc}"
        check(f"GET {path} → {expected}", status == expected, detail)

    status, _ = call(customer, "get", "/merchant/")
    check("customer is redirected away from the merchant UI", status == 302)

    print("\n" + "=" * 60)
    if FAILED:
        print(f"FAILED {len(FAILED)} / {PASSED + len(FAILED)} checks")
        for name in FAILED:
            print(f"  · {name}")
        return 1
    print(f"PASSED all {PASSED} checks")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
