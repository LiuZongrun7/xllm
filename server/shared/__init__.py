"""
shared —— 三端共用的唯一一层
================================================================================
负责人：D（后端 / 架构）

这里只放【必须是同一份】的东西。任何一个文件被复制成三份，都会导致数据不一致：

    models.py       SQLAlchemy 模型（与 database/schema.sql 一一对应）
    extensions.py   db 等扩展
    security.py     会话、@require_role 权限装饰器、current_user
    mailer.py       SMTP 发信（验证码 / 找回密码）
    utils.py        校验正则、统一响应格式
    auth.py         登录 / 注册 / 登出 / 验证码  —— 三种角色共用一套凭据
    health.py       /api/ping、/api/whoami、/api/db-ping

订单状态机（order machine）也应放在这里，避免三端各写一遍 —— 待实现。

⚠️ 不要在这里放任何页面模板或前端样式，那些属于各自的端。
"""
