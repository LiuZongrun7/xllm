# API 契约

xLLM · COMP3019J Final Project · Food Delivery Website
冻结版本：M2 实现完成（与 `server/**/routes.py` 同步维护）

---

## 一、通则

| 项 | 约定 |
|---|---|
| 前缀 | `/api`，nginx **保留**前缀转发（`proxy_pass` 结尾不带斜杠） |
| 分组 | `/api/auth/**`、`/api/customer/**`、`/api/merchant/**`、`/api/rider/**`、`/api/admin/**` |
| 认证 | Flask session（签名 cookie），登录后自动携带，前端无需 token |
| 请求体 | `application/json` |
| 成功 | `{"ok": true, "data": {...}}`（部分接口额外带 `message`） |
| 失败 | `{"ok": false, "error": "英文、可读、带下一步动作"}` |
| 状态码 | 200 成功 · 201 创建 · 400 参数错 · 401 未登录 · 403 角色/归属不符 · 404 不存在 · 409 冲突（状态机/库存/抢单） · 422 数据不合理（GPS） · 429 限频 |
| 归属 | 所有查询在后端带归属条件，前端隐藏按钮只是体验，不是权限 |
| 金额 | `number`，两位小数，货币符号由前端加（`¥`） |
| 时间 | ISO 8601（服务器本地时间，无时区后缀），前端显示 `HH:mm` / `Oct 22` |

### 状态词表（三端唯一语言契约）

| `orders.status` | UI label | 谁能推进 |
|---|---|---|
| `pending` | Placed | 商家 `Accept` / `Decline`；顾客 `Cancel order` |
| `accepted` | Accepted | 商家 `Start preparing`；顾客可取消 |
| `preparing` | Preparing | 商家 `Mark ready` / `Flag delay` |
| `ready` | Ready | 骑手 `Grab order` → 归属落库 |
| `delivering` | On the way | 骑手 `Confirm delivered` |
| `delivered` | Delivered | 顾客 `Rate this order` |
| `cancelled` | Cancelled | 终态 |

---

## 二、认证 `/api/auth`（三端共用）

| 方法 | 路径 | 载荷 | 说明 |
|---|---|---|---|
| POST | `/register` | `{username, email, password, role, phone?}` | `role ∈ customer\|restaurant\|rider`；注册即登录；201 |
| POST | `/login` | `{account, password}` | `account` 可以是用户名或邮箱 |
| POST | `/code/send` | `{email, purpose}` | `purpose ∈ login\|reset_password`；60 秒限频、每小时 5 条 |
| POST | `/code/login` | `{email, code}` | 验证码登录，成功即验证邮箱 |
| POST | `/password/reset` | `{email, code, new_password}` | 成功后清空会话 |
| GET | `/me` | — | 当前用户，未登录 401 |
| POST | `/logout` | — | 清空会话 |
| POST | `/mail/test` | — | 部署自检：给本人发测试邮件 |

安全约束：验证码只存哈希、5 分钟过期、一次性、错 5 次作废；不泄露"邮箱是否注册"；
密码错误与账号不存在返回同一句 `Incorrect account or password`。

---

## 三、顾客端 `/api/customer`

### 浏览

| 方法 | 路径 | 参数 | data |
|---|---|---|---|
| GET | `/restaurants` | `q` `cuisine` `open=1` `sort=distance\|rating\|eta` | `{restaurants[], cuisines[], address}` |
| GET | `/restaurants/<id>` | — | 餐厅详情 + `menu[{category, items[]}]` + `state` + `distance_km` + `within_radius` + `reviews[]` |
| GET | `/search` | `q` | `{query, restaurants[], dishes[]}` |
| GET | `/config` | — | `{amap_js_key, amap_security_code}`（无 Key 时为空串，前端降级） |

餐厅对象关键字段：

```json
{
  "id": 1, "name": "Golden Wok Kitchen", "cuisine": "Chinese", "emoji": "🥢",
  "rating": 4.6, "review_count": 12, "distance_km": 1.2, "eta_minutes": 23,
  "min_order_amount": 20.0, "delivery_fee": 5.0, "delivery_radius_km": 5.0,
  "state": {"accepting": true, "reason": null, "label": "Open",
            "detail": "Open until 22:00", "active_orders": 3,
            "capacity": 20, "seats_left": 17}
}
```

`state.reason` 用来区分"为什么不能下单"：`paused`（店家打烊）/ `hours`（不在营业时段）/ `full`（备餐产能满）。

菜品对象：`{id, name, description, price, calories, category, stock, is_available, sold_out, emoji}`。
`stock = null` 表示不限量；`sold_out` 是后端算好的，前端直接用。

### 地址簿

| 方法 | 路径 | 载荷 |
|---|---|---|
| GET | `/addresses` | — |
| POST | `/addresses` | `{label?, contact_name, contact_phone, address_text, lng, lat, is_default?}` |
| DELETE | `/addresses/<id>` | —（默认地址不允许删） |
| POST | `/addresses/<id>/default` | — |

### 下单

`POST /orders`

```json
{
  "restaurant_id": 1,
  "address_id": 3,
  "items": [{"menu_item_id": 11, "quantity": 2}],
  "remark": "No cutlery",
  "payment_method": "card"
}
```

后端按顺序校验并返回具体原因：餐厅存在 → 地址归属 → 营业/产能 → 菜品在售与库存 →
起送价 → 配送半径。成功 201，`data.order` 为订单详情（含 `order_no`、`total_amount`）。

`payment_method` 目前只是记录在备注里（模拟支付，不接网关）。

### 订单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/orders` | `{active[], past[], active_count}`，`past` 为详情对象 |
| GET | `/orders/<id>` | 详情 + `steps[]` + `actions` + `can_cancel` + `can_change_address` + `can_review` + `rider_location` + `payment_label` |
| POST | `/orders/<id>/cancel` | `{reason?}`；仅 pending / accepted；已付款置为 refunded |
| POST | `/orders/<id>/address` | `{address_id}`；**取餐前**可改配送地址（FR-19），重算距离与预计时间，骑手端可见变更 |
| POST | `/orders/<id>/review` | `{restaurant_rating(1-5), rider_rating?, content?}` |
| GET | `/active-order` | 首页横幅用；无进行中订单时 `order: null` |

时间轴节点：`{status, label, at, state}`，`state ∈ done|current|todo|cancelled`。

### 优惠券与券包

券由平台**官方发行**：新人限时券（注册自动到账，48 小时）+ **付费券包**（买断一组券）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/customer/coupons` | 我的券：`available` / `used` / `expired`；带 `restaurant_id` + `items_amount` 时附 `applicable`、`reason`、`discount_preview` |
| GET | `/api/customer/coupon-packages` | 券包货架：价格、面额、张数、有效期、限购、剩余、`can_buy` |
| POST | `/api/customer/coupon-packages/<id>/purchase` | 购买券包（模拟支付）：原子扣库存 → 记购买 → 批量发券 |

下单时在 body 里加 `user_coupon_id`：

* 金额只由服务端计算：`total = items + delivery_fee − discount`；
* 核销是条件更新（`status='unused'` 才成功），重复使用返回 `409`；
* 取消订单会把券退回（已过期则作废）；
* 别人的券返回 `404`，与"订单不存在"一致，不泄露存在性。

### 资料

`GET /profile` → `{user, default_address, order_count}`
`PATCH /profile` → `{name?, phone?, avatar_url?}`

---

## 四、商家端 `/api/merchant`

### 店铺

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/store` | `{restaurant, state, opening_hours}`；未开店时 `restaurant: null` |
| POST | `/store` | 开店：`{name, phone, address_text, lng, lat, cuisine?, description?, min_order_amount?, delivery_fee?, delivery_radius_km?, max_concurrent_orders?, avg_prep_minutes?}` |
| PATCH | `/store` | 店铺资料局部更新 |
| GET | `/settings` | 同 `/store`，另带 `weekday_names` |
| PUT | `/settings` | `{is_open?, max_concurrent_orders?, avg_prep_minutes?, delivery_radius_km?, min_order_amount?, delivery_fee?, description?, name?, phone?, cuisine?, opening_hours?: [{weekday, open_time:"HH:MM", close_time, is_closed}]}` |
| POST | `/status` | `{is_open}` 顶栏开关 |

### 总览 / 看板

`GET /dashboard` →

```json
{
  "restaurant": {...}, "state": {...},
  "kpis": {"today_orders":3,"today_revenue":0.0,"active_orders":3,
           "delayed_orders":0,"awaiting_rider":1,"cancel_rate":0.0,
           "avg_prep_minutes":16.0,"cancelled_today":0,"today_delivered":0},
  "queue": {"counts": {"pending":1,"accepted":0,"preparing":1,"ready":1,"delivering":0},
            "buckets": {"pending":[...]}, "orders": [...]},
  "issues": [...]
}
```

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/orders?status=` | 不传 status 时只返回进行中的单；`status` 可逗号分隔（如 `pending,accepted`） |
| GET | `/orders/<id>` | 详情 + `actions` + 时间轴 |
| POST | `/orders/<id>/accept` | pending → accepted（409 = 状态已变） |
| POST | `/orders/<id>/preparing` | accepted → preparing |
| POST | `/orders/<id>/ready` | preparing → ready |
| POST | `/orders/<id>/decline` | `{reason?}` → cancelled（refunded） |
| POST | `/orders/<id>/delay` | `{reason?}`，不改变状态，预计送达 +10 分钟 |

### 菜单

| 方法 | 路径 | 载荷 |
|---|---|---|
| GET | `/menu-items` | `{items[], categories[], stats{total,sold_out,low_stock}}` |
| POST | `/menu-items` | `{name, price, description?, calories?, category?, stock?, is_available?}` |
| PATCH | `/menu-items/<id>` | 上述字段任选 |
| DELETE | `/menu-items/<id>` | 历史订单靠 `order_items` 快照还原，不受影响 |
| PATCH | `/menu-items/<id>/stock` | `{stock: number\|null, is_available?}` |
| POST | `/menu-items/restock` | `{threshold?:5, amount?:40}` 一键补货，返回 `{updated}` |

菜品对象另带 `stock_state ∈ in_stock|low_stock|sold_out`（商家端三档胶囊）。

### 异常 / 分析

`GET /issues` → `{issues[], counts}`；`kind ∈ no_rider|delayed|address|cancelled|sold_out`，
`severity ∈ warning|danger|neutral`。

`GET /analytics?days=7` → `{days, kpis, daily[{date,label,orders,revenue,cancelled}],
top_items[{name,quantity,revenue}], hourly[24], status[{status,count}]}`。

---

## 五、骑手端 `/api/rider`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workbench` | `{profile, stats, pool[], active[], pool_count}` |
| GET | `/pool` | 可接单池：`status=ready AND rider_id IS NULL` |
| POST | `/orders/<id>/claim` | **原子抢单**；未上线 409；被别人抢走 409 |
| GET | `/orders` | 我的进行中配送（`ready` 已抢未取 + `delivering` 配送中） |
| GET | `/orders/<id>` | 详情；池中的单也可看（供抢前判断） |
| POST | `/orders/<id>/pickup` | ready → delivering |
| POST | `/orders/<id>/deliver` | delivering → delivered |
| POST | `/orders/<id>/location` | `{lng, lat, accuracy_m?}`；精度 > 200m 或速度 > 80km/h 返回 422 |
| POST | `/status` | `{is_online}` |
| GET | `/profile` | `{user, profile, stats}` |
| PATCH | `/profile` | `{name?, phone?, vehicle_type?, service_radius_km?}` |
| GET | `/history?days=30` | `{orders[], summary{deliveries,distance_km,days}}` |

池中订单对象额外带 `pickup{name,address_text,lng,lat,phone}`、`dropoff{...}`、
`trip_km`、`waiting_minutes`、`address_updated_at`（顾客改过地址时非空，前端提示骑手）。

订单明细（`items[]`）在三端都带 `emoji`，保证同一道菜在顾客端 / 商家端 / 骑手端长得一样。

### 抢单为什么必须原子

```sql
UPDATE orders SET rider_id = :me
 WHERE id = :order_id AND status = 'ready' AND rider_id IS NULL;
-- 然后检查 rowcount：0 表示慢了一步
```

`SELECT` 再 `UPDATE` 中间存在竞态窗口，两个骑手会同时"成功"。这段实现见
`server/rider/routes.py::claim`，是 FR-21 的验收点。

---

## 六、管理大屏 `/api/admin`

只读的运营视角，**没有写接口**。详见 [`管理大屏.md`](管理大屏.md)。

| 路径 | 用途 | 未登录 |
|---|---|---|
| `GET /api/admin/overview?window=today\|24h\|7d` | 整屏数据（KPI / 趋势 / 状态分布 / 门店 / 骑手 / 告警 / 实时流水） | 401 |
| `GET /api/admin/orders/<id>` | 抽屉里的单笔详情（时间轴 + 计时 + 骑手位置） | 401 |

- 认证不走 `users` 表：`ADMIN_USER` / `ADMIN_PASSWORD` 环境变量 + 独立 session 键 `ops_session`；
- `window` 不认识的取值回落到 `today`；`orders/<id>` 不存在返回 404；
- 响应结构、指标口径与告警规则见 [`管理大屏.md`](管理大屏.md) §4–§5。

---

## 七、健康检查 `/api`

| 路径 | 用途 |
|---|---|
| `GET /api/ping` | nginx → gunicorn → Flask 是否通 |
| `GET /api/whoami` | 解释器 / Flask / 工作目录（排查"本地能跑线上报错"） |
| `GET /api/db-ping` | MySQL 连接与版本 |

---

## 八、错误文案约定

错误信息要**给下一步动作**，不只报错：

| 场景 | 文案 |
|---|---|
| 未达起送价 | `Add ¥3.50 more to reach the ¥20.00 minimum order` |
| 菜品售罄 | `“Beef Fried Rice” is sold out — remove it from your cart` |
| 超出配送范围 | `This address is 6.4 km away, outside …'s 5 km delivery radius — pick a closer address` |
| 店家打烊 | `Golden Wok Kitchen is not taking orders right now — The restaurant has paused orders` |
| 抢单失败 | `Too late — another rider grabbed this order first` |
| 状态已变 | `Cannot move this order from Preparing to Preparing` |
| GPS 太差 | `GPS signal is too weak to report a position — move somewhere more open and try again` |
