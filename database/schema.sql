-- ============================================================================
--  xLLM · COMP3019J Final Project — Food Delivery Website
--  数据库结构  schema.sql
-- ----------------------------------------------------------------------------
--  目标: MySQL 8.0 / InnoDB / utf8mb4
--  用法: mysql -u webapp -p webapp < schema.sql
--
--  设计要点（M1/M3 答辩会被问，先写在这）:
--   1. 三种角色共用 users 表 + role 字段 —— 关系库没有继承，单表最省事
--   2. 订单是【历史凭证】, 所以地址/价格/菜名在 orders / order_items 里冗余存快照
--      —— 否则用户改地址、商家改价会篡改历史订单
--   3. 状态机 status 是整个项目的骨架, 三个端的界面都围绕它变化
--   4. 时间戳拆成多个 —— 它们是"配送进度"的数据来源, 也是算延迟的依据
--   5. 每张表都有明确的【归属字段】, 权限判断靠它, 不靠前端隐藏
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 1. users  用户（顾客 / 商家主 / 骑手 三种角色共用）
--    归属: 自己
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role`              ENUM('customer','restaurant','rider') NOT NULL COMMENT '角色, 决定登录后进哪个端',
  `username`          VARCHAR(40)     NOT NULL COMMENT '登录账号(用户自选, 唯一)',
  `email`             VARCHAR(120)    NOT NULL COMMENT '注册邮箱, 兼作找回密码/验证码登录通道',
  `name`              VARCHAR(50)     NOT NULL COMMENT '显示名, 注册时默认等于 username',
  `phone`             VARCHAR(20)     NULL     COMMENT '联系电话(可选, 不用于登录)',
  `password_hash`     VARCHAR(255)    NOT NULL COMMENT 'werkzeug 哈希, 绝不存明文',
  `avatar_url`        VARCHAR(255)    NULL     COMMENT '头像',
  `email_verified_at` DATETIME        NULL     COMMENT '邮箱验证时间, NULL=未验证',
  `is_active`         TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '封禁用',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`),
  UNIQUE KEY `uk_users_email` (`email`),
  KEY `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户(三种角色共用)';


-- ---------------------------------------------------------------------------
-- 1b. email_codes  邮箱验证码（找回密码 / 验证码登录 共用）
--     归属: 按 email 索引, 不绑定 user —— 因为找回密码时用户可能还没登录
--     ⚠️ 只存哈希, 不存明文; 有有效期; 一次性; 限错误次数
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `email_codes`;
CREATE TABLE `email_codes` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`      VARCHAR(120)    NOT NULL COMMENT '接收验证码的邮箱',
  `purpose`    ENUM('login','reset_password') NOT NULL COMMENT '用途, 两类验证码互不通用',
  `code_hash`  VARCHAR(255)    NOT NULL COMMENT '验证码的哈希, 不存明文',
  `expires_at` DATETIME        NOT NULL COMMENT '过期时间(默认 5 分钟)',
  `used_at`    DATETIME        NULL     COMMENT '核销时间, 非空表示已用过',
  `attempts`   TINYINT         NOT NULL DEFAULT 0 COMMENT '错误尝试次数, 超限作废',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_codes_lookup` (`email`, `purpose`, `expires_at`),
  KEY `idx_codes_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱验证码';


-- ---------------------------------------------------------------------------
-- 2. restaurants  餐厅（店铺信息, 与 owner 账号分离）
--    归属: owner_id
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `restaurants`;
CREATE TABLE `restaurants` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`           BIGINT UNSIGNED NOT NULL COMMENT '关联 users.id (role=restaurant)',
  `name`               VARCHAR(80)     NOT NULL COMMENT '店名',
  `phone`              VARCHAR(20)     NOT NULL COMMENT '店铺联系电话',
  `address_text`       VARCHAR(255)    NOT NULL COMMENT '文字地址',
  `lng`                DECIMAL(10,7)   NOT NULL COMMENT '经度 (高德地图选点得到)',
  `lat`                DECIMAL(10,7)   NOT NULL COMMENT '纬度',
  `description`        VARCHAR(500)    NULL     COMMENT '简介',
  `cover_url`          VARCHAR(255)    NULL     COMMENT '门头图',
  `min_order_amount`   DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '起送价',
  `delivery_fee`       DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '配送费',
  `delivery_radius_km` DECIMAL(5,2)    NOT NULL DEFAULT 5.00 COMMENT '配送范围(直线距离), 超出不可下单',
  `is_open`            TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '营业总开关, 商家手动打烊',
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_restaurants_owner` (`owner_id`),
  KEY `idx_restaurants_location` (`lat`, `lng`),
  KEY `idx_restaurants_open` (`is_open`),
  CONSTRAINT `fk_restaurants_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='餐厅';


-- ---------------------------------------------------------------------------
-- 3. opening_hours  营业时间（按星期几分开）
--    归属: restaurant_id
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `opening_hours`;
CREATE TABLE `opening_hours` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `restaurant_id` BIGINT UNSIGNED NOT NULL,
  `weekday`       TINYINT         NOT NULL COMMENT '1=周一 ... 7=周日',
  `open_time`     TIME            NOT NULL,
  `close_time`    TIME            NOT NULL,
  `is_closed`     TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '当天整天休息',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hours_rest_weekday` (`restaurant_id`, `weekday`),
  CONSTRAINT `fk_hours_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='营业时间';


-- ---------------------------------------------------------------------------
-- 4. menu_items  菜品
--    归属: restaurant_id
--    注: price 是【当前价格】, 下单时会拷贝一份快照进 order_items
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `menu_items`;
CREATE TABLE `menu_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `restaurant_id` BIGINT UNSIGNED NOT NULL,
  `name`          VARCHAR(80)     NOT NULL COMMENT '菜名',
  `description`   VARCHAR(255)    NULL,
  `price`         DECIMAL(10,2)   NOT NULL COMMENT '当前售价',
  `calories`      INT             NULL     COMMENT '热量(千卡), 手工录入',
  `category`      VARCHAR(30)     NULL     COMMENT '分类: 主食/饮品/小吃...',
  `stock`         INT             NULL     COMMENT '剩余份数, NULL=不限量; 0 表示售罄',
  `is_available`  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '上架/下架',
  `image_url`     VARCHAR(255)    NULL,
  `sort_order`    INT             NOT NULL DEFAULT 0,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_menu_restaurant` (`restaurant_id`, `is_available`),
  CONSTRAINT `fk_menu_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='菜品';


-- ---------------------------------------------------------------------------
-- 5. customer_addresses  顾客收货地址（一对多: 一个顾客多个地址）
--    归属: user_id
--    注: 下单时会把选中的地址【拷贝快照】进 orders
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `customer_addresses`;
CREATE TABLE `customer_addresses` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `label`         VARCHAR(20)     NULL     COMMENT '标签: 家/公司/学校',
  `contact_name`  VARCHAR(50)     NOT NULL COMMENT '收货人',
  `contact_phone` VARCHAR(20)     NOT NULL,
  `address_text`  VARCHAR(255)    NOT NULL COMMENT '格式化地址(高德逆地理编码结果)',
  `lng`           DECIMAL(10,7)   NOT NULL,
  `lat`           DECIMAL(10,7)   NOT NULL,
  `is_default`    TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_addr_user` (`user_id`),
  CONSTRAINT `fk_addr_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='顾客收货地址';


-- ---------------------------------------------------------------------------
-- 6. orders  订单（项目核心表）
--    归属: customer_id / restaurant_id / rider_id 三者共同决定谁能看
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no`      VARCHAR(32)     NOT NULL COMMENT '对外展示的订单号',
  `customer_id`   BIGINT UNSIGNED NOT NULL COMMENT 'FK users.id',
  `restaurant_id` BIGINT UNSIGNED NOT NULL COMMENT 'FK restaurants.id',
  `rider_id`      BIGINT UNSIGNED NULL     COMMENT 'FK users.id, 接单前为 NULL',

  -- ===== 状态机: 整个项目的骨架 =====
  `status` ENUM(
      'pending',      -- 待商家接单
      'accepted',     -- 商家已接单
      'preparing',    -- 备餐中
      'ready',        -- 备好, 待骑手取餐
      'delivering',   -- 骑手已取餐, 配送中
      'delivered',    -- 已送达
      'cancelled'     -- 已取消
  ) NOT NULL DEFAULT 'pending',
  `payment_status` ENUM('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid' COMMENT '虚拟支付, 但状态仍需建模',

  -- ===== 配送地址【快照】, 必须是拷贝而非外键 =====
  `delivery_address_text`  VARCHAR(255)  NOT NULL COMMENT '下单时的地址文字',
  `delivery_lng`           DECIMAL(10,7) NOT NULL COMMENT '下单时的经度',
  `delivery_lat`           DECIMAL(10,7) NOT NULL COMMENT '下单时的纬度',
  `delivery_contact_name`  VARCHAR(50)   NOT NULL,
  `delivery_contact_phone` VARCHAR(20)   NOT NULL,

  -- ===== 金额【快照】=====
  `items_amount`    DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '菜品小计',
  `delivery_fee`    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '优惠券抵扣',
  `total_amount`    DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '实付',

  -- ===== 配送与预估 =====
  `distance_km`           DECIMAL(6,2) NULL COMMENT '直线距离, Haversine 算出',
  `estimated_delivery_at` DATETIME     NULL COMMENT '预计送达时间(估算值)',

  `remark`        VARCHAR(255) NULL COMMENT '顾客备注',
  `cancel_reason` VARCHAR(100) NULL,
  `cancelled_by`  ENUM('customer','restaurant','rider','system') NULL,

  -- ===== 时间戳: 它们就是"配送进度"的数据来源 =====
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下单',
  `accepted_at`  DATETIME NULL COMMENT '商家接单',
  `ready_at`     DATETIME NULL COMMENT '备餐完成',
  `picked_up_at` DATETIME NULL COMMENT '骑手取餐',
  `delivered_at` DATETIME NULL COMMENT '送达',
  `cancelled_at` DATETIME NULL COMMENT '取消',

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_orders_no` (`order_no`),
  KEY `idx_orders_customer`   (`customer_id`, `status`),
  KEY `idx_orders_restaurant` (`restaurant_id`, `status`),
  KEY `idx_orders_rider`      (`rider_id`, `status`),
  KEY `idx_orders_created`    (`created_at`),
  CONSTRAINT `fk_orders_customer`   FOREIGN KEY (`customer_id`)   REFERENCES `users` (`id`),
  CONSTRAINT `fk_orders_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`),
  CONSTRAINT `fk_orders_rider`      FOREIGN KEY (`rider_id`)      REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单';


-- ---------------------------------------------------------------------------
-- 7. order_items  订单明细（一对多: 一个订单多道菜）
--    归属: 通过 order_id 间接归属
--    ⚠️ 白板上漏掉的表 —— 没有它订单不知道自己点了什么
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `order_items`;
CREATE TABLE `order_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`      BIGINT UNSIGNED NOT NULL,
  `menu_item_id`  BIGINT UNSIGNED NULL COMMENT '菜品被删除后置 NULL, 靠下面的快照仍可还原',
  -- ===== 快照: 菜品改名/改价/下架都不影响历史订单 =====
  `name_snapshot` VARCHAR(80)   NOT NULL COMMENT '下单时的菜名',
  `unit_price`    DECIMAL(10,2) NOT NULL COMMENT '下单时的单价',
  `quantity`      INT           NOT NULL DEFAULT 1,
  `subtotal`      DECIMAL(10,2) NOT NULL COMMENT 'unit_price * quantity',
  PRIMARY KEY (`id`),
  KEY `idx_items_order` (`order_id`),
  CONSTRAINT `fk_items_order`     FOREIGN KEY (`order_id`)     REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_items_menu_item` FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单明细';


-- ---------------------------------------------------------------------------
-- 8. reviews  评价（商家评价 + 骑手评价 共用一张表）
--    归属: reviewer_id, 且必须挂在一张已完成的订单上
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `reviews`;
CREATE TABLE `reviews` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`    BIGINT UNSIGNED NOT NULL COMMENT '评价必须挂订单 —— 保证只有下过单的人能评',
  `reviewer_id` BIGINT UNSIGNED NOT NULL COMMENT 'FK users.id (顾客)',
  `target_type` ENUM('restaurant','rider') NOT NULL COMMENT '评的是谁',
  `target_id`   BIGINT UNSIGNED NOT NULL COMMENT 'restaurants.id 或 users.id',
  `rating`      TINYINT         NOT NULL COMMENT '1-5 星 ⚠️ 白板上漏了分数',
  `content`     VARCHAR(500)    NULL,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reviews_order_target` (`order_id`, `target_type`) COMMENT '一单只能评一次',
  KEY `idx_reviews_target` (`target_type`, `target_id`),
  CONSTRAINT `fk_reviews_order`    FOREIGN KEY (`order_id`)    REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reviews_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评价(商家/骑手)';


-- ---------------------------------------------------------------------------
-- 9. rider_locations  骑手位置上报
--    归属: rider_id
--    注: 客户端上报的坐标【不可全信】, 后端要做合理性校验
--        (精度阈值 + 速度上限), 详见 docs/项目规划.md
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `rider_locations`;
CREATE TABLE `rider_locations` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`    BIGINT UNSIGNED NOT NULL COMMENT 'FK users.id',
  `order_id`    BIGINT UNSIGNED NULL     COMMENT '配送中的订单, 便于按订单查轨迹',
  `lng`         DECIMAL(10,7)   NOT NULL,
  `lat`         DECIMAL(10,7)   NOT NULL,
  `accuracy_m`  SMALLINT        NULL     COMMENT '浏览器自报精度(米)',
  `recorded_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '设备端时间',
  PRIMARY KEY (`id`),
  KEY `idx_loc_order` (`order_id`, `recorded_at`),
  KEY `idx_loc_rider` (`rider_id`, `recorded_at`),
  CONSTRAINT `fk_loc_rider` FOREIGN KEY (`rider_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_loc_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手位置上报';


-- ---------------------------------------------------------------------------
-- 10. coupons  优惠券【加分项, 非题目要求】
--     归属: owner_type + owner_id (平台券 owner_id 为 NULL)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `coupons`;
CREATE TABLE `coupons` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`             VARCHAR(32)     NOT NULL COMMENT '券码',
  `title`            VARCHAR(50)     NOT NULL COMMENT '如"满30减5"',
  `owner_type`       ENUM('platform','restaurant') NOT NULL DEFAULT 'platform' COMMENT '谁出的钱',
  `owner_id`         BIGINT UNSIGNED NULL COMMENT 'owner_type=restaurant 时指向 restaurants.id',
  `discount_type`    ENUM('fixed','percent') NOT NULL COMMENT '固定金额 / 折扣',
  `discount_value`   DECIMAL(10,2)   NOT NULL COMMENT 'fixed=金额, percent=折扣率(0.85=85折)',
  `min_order_amount` DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '使用门槛',
  `total_quantity`   INT             NULL COMMENT '发行总量, NULL=不限',
  `claimed_count`    INT             NOT NULL DEFAULT 0 COMMENT '已领取数',
  `start_at`         DATETIME        NULL,
  `end_at`           DATETIME        NULL,
  `is_active`        TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_coupons_code` (`code`),
  KEY `idx_coupons_owner` (`owner_type`, `owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='优惠券(加分项)';


-- ---------------------------------------------------------------------------
-- 11. user_coupons  用户领券与核销记录
--     归属: user_id
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `user_coupons`;
CREATE TABLE `user_coupons` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `coupon_id`  BIGINT UNSIGNED NOT NULL,
  `status`     ENUM('unused','used','expired') NOT NULL DEFAULT 'unused',
  `order_id`   BIGINT UNSIGNED NULL COMMENT '核销时写入, 保证一张券只能用一次',
  `claimed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `used_at`    DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_usercoupon` (`user_id`, `coupon_id`) COMMENT '每人每券限领一张',
  KEY `idx_usercoupon_status` (`user_id`, `status`),
  KEY `idx_usercoupon_order` (`order_id`),
  CONSTRAINT `fk_uc_user`   FOREIGN KEY (`user_id`)   REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uc_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uc_order`  FOREIGN KEY (`order_id`)  REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户领券记录';


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
--  权限归属速查（写接口时对照这张表，每个查询都要带归属条件）
-- ----------------------------------------------------------------------------
--  顾客  → 只能读写  customer_addresses(user_id=自己)
--                   orders(customer_id=自己) / order_items(自己的订单)
--                   reviews(reviewer_id=自己)
--                   user_coupons(user_id=自己)
--          只能读    restaurants / menu_items / opening_hours (公开信息)
--
--  商家  → 只能读写  restaurants(owner_id=自己) / opening_hours / menu_items
--                   orders(restaurant_id=自己的店) —— 且只能改特定状态字段
--          只能读    reviews(target_type='restaurant' AND target_id=自己的店)
--                   users(只读顾客的姓名电话, 且仅限自己订单上的)
--
--  骑手  → 只能读写  rider_locations(rider_id=自己)
--          只能读    orders(status='ready' AND rider_id IS NULL)  ← 可接单池
--                   orders(rider_id=自己)                         ← 自己的单
--          只能改    orders.rider_id / status (限 ready→delivering→delivered)
-- ============================================================================
