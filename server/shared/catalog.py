"""
展示层小工具：菜品 / 店铺的占位视觉

我们没有真实的菜品照片，也不想盗用参考素材里的图片，所以三端统一用
"渐变底 + 一个 emoji"作为占位视觉（前端负责渐变，这里只决定 emoji）。
放 shared/ 里的理由：同一道菜在顾客端和商家端必须长得一样，
否则商家改库存时会对不上顾客看到的那一项。
"""

# 关键词 → emoji。按顺序匹配，越具体的放越前面。
_DISH_EMOJI = (
    ("dumpling", "🥟"), ("wonton", "🥟"), ("bao", "🥟"),
    ("noodle", "🍜"), ("ramen", "🍜"), ("udon", "🍜"), ("pho", "🍜"),
    ("sushi", "🍣"), ("sashimi", "🍣"), ("maki", "🍣"), ("roll", "🍣"),
    ("rice", "🍚"), ("bowl", "🍚"), ("congee", "🥣"),
    ("burger", "🍔"), ("sandwich", "🥪"), ("pizza", "🍕"), ("taco", "🌮"),
    ("salad", "🥗"), ("veg", "🥦"), ("tofu", "🥘"),
    ("soup", "🍲"), ("hotpot", "🍲"), ("curry", "🍛"),
    ("chicken", "🍗"), ("wing", "🍗"), ("duck", "🍗"),
    ("beef", "🥩"), ("steak", "🥩"), ("pork", "🥓"), ("lamb", "🍖"),
    ("fish", "🐟"), ("shrimp", "🦐"), ("prawn", "🦐"), ("crab", "🦀"),
    ("egg", "🥚"), ("bread", "🥖"), ("bun", "🥯"),
    ("tea", "🍵"), ("coffee", "☕"), ("juice", "🧃"), ("soda", "🥤"),
    ("milkshake", "🥤"), ("water", "💧"), ("beer", "🍺"),
    ("cake", "🍰"), ("ice", "🍨"), ("dessert", "🍮"), ("sweet", "🍬"),
    ("mango", "🥭"), ("fruit", "🍓"),
)

# 分类兜底
_CATEGORY_EMOJI = {
    "starters": "🥟", "starter": "🥟",
    "mains": "🍚", "main": "🍚",
    "noodles": "🍜", "noodle": "🍜",
    "rice": "🍚", "sushi": "🍣", "grill": "🍖",
    "soup": "🍲", "salad": "🥗",
    "drinks": "🥤", "drink": "🥤", "dessert": "🍰", "desserts": "🍰",
    "sides": "🥢", "specials": "⭐",
}

# 店铺 cover emoji
_CUISINE_EMOJI = {
    "chinese": "🥢", "noodles": "🍜", "japanese": "🍣", "korean": "🍲",
    "thai": "🍛", "indian": "🍛", "italian": "🍕", "western": "🍔",
    "salad": "🥗", "dessert": "🍰", "drinks": "🥤", "cafe": "☕",
}


def dish_emoji(name: str, category: str | None = None) -> str:
    haystack = f"{name} {category or ''}".lower()
    for word, emoji in _DISH_EMOJI:
        if word in haystack:
            return emoji
    if category:
        hit = _CATEGORY_EMOJI.get(category.strip().lower())
        if hit:
            return hit
    return "🍽️"


def cuisine_emoji(cuisine: str | None) -> str:
    return _CUISINE_EMOJI.get((cuisine or "").strip().lower(), "🍽️")


# ---------------------------------------------------------------------------
# 实拍图 —— 菜品一张一张，店铺一张一张
#
# 图片本身在 server/static/img/food/ 下（三端共用：同一道菜在顾客端和商家端
# 必须长得一样）。这里只维护"菜名 → 文件名"和"店名 → 文件名"两张表。
#
# ⚠️ 为什么按名字而不是按 id：id 在不同库（本地 SQLite / 线上 MySQL）里不一样，
#    名字是种子数据的一部分，两边一致。换菜名要同时改这里，否则会退回 emoji ——
#    这是刻意的设计：**缺图不是错误**，emoji 是永久可用的兜底。
#
# ⚠️ 图片全部是 AI 生成的（火山方舟 Seedream），提示词与色板在 docs/art-spec.json，
#    重出用 `node tools/gen-art.mjs`。不引用任何第三方素材。
# ---------------------------------------------------------------------------

IMAGE_DIR = "/static/img/food"

_DISH_IMAGES = {
    # Golden Wok Kitchen
    "Crispy Spring Rolls (4 pcs)": "dish-spring-rolls.jpg",
    "Pork & Chive Dumplings (6 pcs)": "dish-dumplings.jpg",
    "Hot & Sour Soup": "dish-hotsour.jpg",
    "Teriyaki Chicken Bowl": "dish-teriyaki.jpg",
    "Kung Pao Chicken": "dish-kungpao.jpg",
    "Mapo Tofu": "dish-mapo.jpg",
    "Sweet & Sour Pork": "dish-sweetsour.jpg",
    "Beef Fried Rice": "dish-friedrice.jpg",
    "Iced Lemon Tea": "dish-lemontea.jpg",
    "Mango Pudding": "dish-mangopudding.jpg",
    # Noodle Bar
    "Beef Noodle Soup": "dish-beefnoodle.jpg",
    "Spicy Dan Dan Noodles": "dish-dandan.jpg",
    "Wonton Noodles": "dish-wonton.jpg",
    "Scallion Oil Noodles": "dish-scallion.jpg",
    "Cucumber Salad": "dish-cucumber.jpg",
    "Braised Egg": "dish-braisedegg.jpg",
    "Soy Milk": "dish-soymilk.jpg",
    "Plum Juice": "dish-plumjuice.jpg",
    # Sakura Sushi House
    "Salmon Nigiri (4 pcs)": "dish-nigiri.jpg",
    "Tuna Roll (8 pcs)": "dish-tunaroll.jpg",
    "California Roll (8 pcs)": "dish-calroll.jpg",
    "Sashimi Platter": "dish-sashimi.jpg",
    "Edamame": "dish-edamame.jpg",
    "Miso Soup": "dish-misosoup.jpg",
    "Chawanmushi": "dish-chawanmushi.jpg",
    "Cold Green Tea": "dish-greentea.jpg",
    "Matcha Ice Cream": "dish-matcha.jpg",
    # Green Bowl Salad
    "Grilled Chicken Caesar": "dish-caesar.jpg",
    "Avocado Quinoa Bowl": "dish-quinoa.jpg",
    "Smoked Salmon Bowl": "dish-smoked.jpg",
    "Cold-pressed Orange": "dish-orange.jpg",
    "Green Detox Juice": "dish-detox.jpg",
}

_RESTAURANT_COVERS = {
    "Golden Wok Kitchen": "cover-goldenwok.jpg",
    "Noodle Bar": "cover-noodlebar.jpg",
    "Sakura Sushi House": "cover-sakura.jpg",
    "Green Bowl Salad": "cover-greenbowl.jpg",
}


def dish_image(name: str | None) -> str | None:
    """菜名 → 可直接放进 <img src> 的路径；没有就返回 None，前端退回 emoji"""
    filename = _DISH_IMAGES.get((name or "").strip())
    return f"{IMAGE_DIR}/{filename}" if filename else None


def restaurant_cover(name: str | None) -> str | None:
    filename = _RESTAURANT_COVERS.get((name or "").strip())
    return f"{IMAGE_DIR}/{filename}" if filename else None
