#!/usr/bin/env python3
"""
给已有数据库补上菜品图和店铺封面

    cd server && set -a && . ../.env && set +a && ../.venv/bin/python ../tools/backfill-images.py

为什么需要这个脚本
    图片路径是种子数据的一部分（`shared/catalog.py` 里那张"菜名 → 文件名"的表），
    但线上库早就灌过数据了，**重跑种子会清空订单**。所以这里只做一件事：
    按菜名/店名把 `menu_items.image_url` 和 `restaurants.cover_url` 补上。

    幂等：图没变就不写；改了表里的文件名再跑一次即可。

刻意不做的事
    - 不创建、不删除任何行
    - 不动订单、库存、营业状态
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from app import create_app                                    # noqa: E402
from shared.catalog import dish_image, restaurant_cover        # noqa: E402
from shared.extensions import db                               # noqa: E402
from shared.models import MenuItem, Restaurant                 # noqa: E402


def main() -> int:
    app = create_app()
    with app.app_context():
        covers = dishes = 0

        for rest in Restaurant.query.all():
            want = restaurant_cover(rest.name)
            if want and rest.cover_url != want:
                rest.cover_url = want
                covers += 1

        for item in MenuItem.query.all():
            want = dish_image(item.name)
            if want and item.image_url != want:
                item.image_url = want
                dishes += 1

        db.session.commit()

        missing = [i.name for i in MenuItem.query.all() if not i.image_url]
        print(f"[backfill] 店铺封面 {covers} 条，菜品图 {dishes} 条")
        if missing:
            print(f"[backfill] 仍没有图的菜（会显示 emoji 占位）：{len(missing)} 道")
            for name in missing:
                print(f"           · {name}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
