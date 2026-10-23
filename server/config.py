"""
配置 —— 全部从环境变量读取，密钥不写进代码

本地开发：在 server/ 下建 .env 或直接 export
服务器：  /home/ubuntu/xllm/.env （权限 600，由 systemd 的 EnvironmentFile 加载）
"""

import os
from datetime import timedelta
from urllib.parse import quote_plus


class Config:
    # Flask 会话签名用。生产必须换成随机值，否则 session 可被伪造。
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-do-not-use-in-production")

    # ---------------- 数据库 ----------------
    DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
    DB_PORT = os.environ.get("DB_PORT", "3306")
    DB_NAME = os.environ.get("DB_NAME", "webapp")
    DB_USER = os.environ.get("DB_USER", "webapp")
    DB_PASSWORD = os.environ.get("DB_PASSWORD", "")

    # 驱动选 PyMySQL：纯 Python，pip 装完就能用，不需要编译 mysqlclient
    # 密码必须 URL 编码，否则密码里出现 @ : / # 之类的字符会把连接串拆坏
    #
    # DATABASE_URL 是给本地开发用的逃生口：把整条连接串直接塞进来就能绕过上面
    # 五个变量，例如
    #     DATABASE_URL=sqlite:///$(pwd)/dev.db python app.py
    # 生产不设它，永远走 MySQL。
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL") or (
        "mysql+pymysql://{user}:{pwd}@{host}:{port}/{db}?charset=utf8mb4".format(
            user=quote_plus(DB_USER),
            pwd=quote_plus(DB_PASSWORD),
            host=DB_HOST,
            port=DB_PORT,
            db=DB_NAME,
        )
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        # MySQL 默认 8 小时掐断空闲连接（wait_timeout）。
        # 不加这两项，第二天第一个请求必然报 "MySQL server has gone away"。
        "pool_pre_ping": True,    # 取连接前先 ping 一下，断了就重连
        "pool_recycle": 280,      # 每 280 秒主动回收
    }

    # ---------------- 邮件（验证码 / 找回密码 / 自检） ----------------
    # ⚠️ MAIL_PASSWORD 是腾讯企业邮的【授权码】，不是邮箱登录密码。
    #    它只能存在于服务器 .env，绝对不能进 Git。
    #
    # 发送身份：系统自动发的邮件只有一种，就是 no-reply@。noreply 的语义就是
    # "只出不进"，不需要人监控，也不该接受回复。
    #
    # ⚠️ MAIL_SENDER 必须与 MAIL_USER 是同一个账号。
    #    腾讯企业邮会用"实际登录的账号"校验 From 头，两者不一致会被拒绝(553)
    #    或强行改写回登录账号。换发件地址必须连 MAIL_USER 一起换。
    MAIL_HOST = os.environ.get("MAIL_HOST", "smtp.exmail.qq.com")
    MAIL_PORT = int(os.environ.get("MAIL_PORT") or 465)
    MAIL_USER = os.environ.get("MAIL_USER", "no-reply@xllm.cloud")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD")
    MAIL_SENDER = os.environ.get("MAIL_SENDER") or MAIL_USER
    # 显示名：英文（与 UI 语言一致）。含空格，.env 里必须加引号。
    # 设成空字符串则只显示地址、不显示名字。
    MAIL_SENDER_NAME = os.environ.get("MAIL_SENDER_NAME", "xLLM Food Delivery")

    # 回复地址：no-reply@ 不收信，用户点"回复"会退信。
    # Reply-To 只是一个头字段，**不需要**该邮箱的任何授权码。
    # 设成空字符串则不加这个头。
    MAIL_REPLY_TO = os.environ.get("MAIL_REPLY_TO", "contact@xllm.cloud")

    # ---------------- 高德地图（地址选点 / 骑手位置展示） ----------------
    # 三个都是可选的：没配 Key 时前端自动降级成"纯文本地址 + 城市中心坐标"，
    # 核心下单流程不受影响（见 docs/部署说明.md §7）。
    AMAP_JS_KEY = os.environ.get("AMAP_JS_KEY", "")
    AMAP_SECURITY_CODE = os.environ.get("AMAP_SECURITY_JS_CODE", "")
    AMAP_WEB_KEY = os.environ.get("AMAP_WEB_KEY", "")

    # ---------------- 管理大屏（/admin） ----------------
    # 运营账号不属于 users 表里的任何一种角色，所以它没有数据库记录，
    # 只有这一对凭据 —— 见 server/admin/routes.py 顶部说明。
    #
    # ADMIN_PASSWORD 的默认值是演示口令，与三个演示账号一致，
    # 这样答辩时不用先配环境变量也能打开大屏；正式环境请务必覆盖：
    #     ADMIN_PASSWORD='...'  写进服务器 .env
    # 只要密码不是默认值，登录页上的演示提示会自动消失。
    ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
    ADMIN_DEMO_PASSWORD = "demo1234"
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or ADMIN_DEMO_PASSWORD

    # ---------------- 会话 ----------------
    # 线上全站 HTTPS，所以 cookie 应当只走加密通道。
    # 本地用 http://127.0.0.1 调试时设成 0，否则浏览器不会带上 cookie。
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
