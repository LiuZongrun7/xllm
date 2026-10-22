"""
Flask 扩展实例

单独放一个文件，避免 app.py 和各个 blueprint 互相 import 造成循环依赖。
"""

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
