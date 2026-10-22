# 界面截图

这些图**不是参考素材**，而是本项目在本地跑起来之后用无头 Chromium 截的实际界面，
用来做 README、报告附录和答辩 PPT。可以随时重截。

| 文件 | 页面 | 视口 |
|---|---|---|
| `customer-home.png` | 顾客端首页 | 430×900 |
| `customer-restaurant.png` | 餐厅菜单 | 430×900 |
| `customer-checkout.png` | 结算页 | 430×900 |
| `customer-order.png` | 订单进度 | 430×900 |
| `customer-orders.png` | 我的订单 | 430×900 |
| `customer-login.png` | 顾客登录 | 430×900 |
| `customer-account.png` | 账户 | 430×900 |
| `merchant-dashboard.png` | 商家总览 | 1440×900 |
| `merchant-orders.png` | 订单看板 | 1440×900 |
| `merchant-menu.png` | 菜单与库存 | 1440×900 |
| `merchant-settings.png` | 营业设置 | 1440×900 |
| `merchant-analytics.png` | 营业分析 | 1440×900 |
| `merchant-issues.png` | 异常与售后 | 1440×900 |
| `merchant-login.png` | 商家登录 | 1440×900 |
| `rider-workbench.png` | 骑手工作台 | 430×900 |
| `rider-order.png` | 配送详情 | 430×900 |
| `rider-history.png` | 配送历史 | 430×900 |
| `rider-settings.png` | 骑手设置 | 430×900 |
| `rider-login.png` | 骑手登录 | 430×900 |

## 怎么重新截

```bash
# 1) 本地准备好数据
./tools/dev.sh --reset          # 另开一个终端保持运行

# 2) 截图（Chromium 由 Playwright 提供）
node shot.js http://127.0.0.1:8080/customer/ docs/screenshots/customer-home.png 430 alex
```

`shot.js` 只做三件事：登录、等网络空闲、整页截图。

## 注意

- 这些是**我们自己的界面**，可以进 Git、可以放进报告。
- `docs/reference/ui/` 里的截图是别家产品的参考素材，**不能**混进来（`.gitignore` 已排除）。
