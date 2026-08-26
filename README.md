# WBFlow · WB（Wildberries中国）前台一键搬品

把**任意平台的商品**一键搬到 Wildberries 中国站（seller.wildberries.cn）的自动化工具。
粘贴源商品链接或手动填写商品信息 → 选择WB类目、补全特性 → 工具自动完成：**下载图片 → 创建商品卡片 → 上传图片 → 设置价格 → 设置库存**。

## 功能

- 🔗 **源商品解析**：支持任意电商商品页（Open Graph / JSON-LD Product 协议），WB 商品页尽力解析；被反爬的站点（淘宝/京东/1688 等）可切换**手动输入**模式
- 🗂️ **WB类目与特性**：实时拉取官方类目树与子类目特性（中文），必填/变体/多值标注，重量尺寸类特性自动映射为包装尺寸（kg/cm）
- 🏷️ **品牌与SKU**：按类目拉取品牌候选，商家SKU留空自动生成
- 🚀 **一键搬品**：全自动执行建卡→传图→定价→库存六步流水线，实时进度展示
- 🧾 **搬品历史**：任务持久化，可回看每一步结果与失败原因（俄语错误自动翻译为中文提示）
- 🔐 **令牌安全**：令牌存放于 `.env`（已 gitignore），服务端统一鉴权

## 快速开始

```bash
# 1. 安装依赖（Node.js ≥ 18）
npm install

# 2. 配置令牌
#    复制 .env.example 为 .env，填入你的 WB API 令牌（dev.wildberries.cn 生成）
#    令牌需包含 Content（商品管理）权限，建议同时开通 Prices、Marketplace 权限

# 3. 启动
npm start
# 打开 http://localhost:3000
```

## 界面流程

1. **源商品**：粘贴商品链接 → 点「解析商品」查看解析结果（标题/图片/价格/品牌）；或切到「手动输入」直接填
2. **WB目标配置**：选父级类目 → 子类目 → 自动加载特性表单并尝试用源商品属性预填 → 填品牌（下拉候选）与商家SKU
3. **定价与库存**：售价、折扣、仓库（自动列出）、库存数量
4. **一键搬品**：点击后实时显示六步进度与最终卡片编号（nmID）和后台链接

## 技术架构

```
WBFlow/
├── server/
│   ├── index.js            # Express 入口（静态前台 + API + 健康检查）
│   ├── config.js           # 配置（.env 加载、网关地址、数据目录）
│   ├── wbClient.js         # WB API 客户端（统一鉴权/错误解析/429与5xx重试）
│   ├── contentApi.js       # 内容API：类目/特性/品牌/字典/建卡/传图/条码/卡片查询
│   ├── marketplaceApi.js   # 市场与定价API：仓库/库存/价格任务
│   ├── sourceFetcher.js    # 源商品解析器（JSON-LD/OG/meta + WB页面 + 手动）
│   ├── migrateService.js   # 一键搬品编排（六步流水线、错误翻译、同步等待）
│   └── routes.js           # REST 路由
├── public/                 # 前台（原生JS单页，无构建步骤）
└── docs_ref/               # 离线接口文档与提取/分析脚本（开发参考）
```

## 接口网关（dev.wildberries.cn 实测确认）

| 能力 | 网关 |
|---|---|
| 商品内容（类目/特性/建卡/传图） | `https://content-api.wildberries.cn` |
| 价格与折扣 | `https://discounts-prices-api.wildberries.cn` |
| 仓库与库存 | `https://marketplace-api.wildberries.cn` |

`locale=zh` 参数可返回中文类目与特性名。

## 一键搬品流水线

```
① 准备商品数据 → ② 下载图片(≤15张,并发3) → ③ 创建卡片(POST /content/v2/cards/upload)
→ ④ 上传图片(POST /content/v3/media/file, X-Nm-Id/X-Photo-Number)
→ ⑤ 设置价格(POST /api/v2/upload/task → 轮询 history/tasks, 自动等待新卡同步, 最长5分钟)
→ ⑥ 设置库存(PUT /api/v3/stocks/{warehouseId})
```

### 已知的平台规则（开发中踩坑记录）

- **无尺寸类目**（如数据线）不能传 `sizes`，传了会进"草稿/错误"状态并提示俄语错误
- **重量/尺寸类特性**（带包装重量等）必须通过 `variants[].dimensions.weightBrutto`（单位**千克**）传递，不能放在 `characteristics` 里
- **新卡片同步延迟**：新卡在价格服务中可见有数分钟延迟，工具会自动等待并重试
- 品牌需为账号已注册品牌，否则建卡报错
- 价格任务状态为数字编码：`3`=成功 `4`=取消 `5`=部分错误 `6`=全部错误

## 源商品解析限制

- WB前台（wildberries.cn / wildberries.ru）对服务器请求有反爬，URL解析为尽力而为；失败时请用**手动输入**
- 淘宝/天猫/京东/1688/拼多多等国内平台反爬严格，建议手动输入
- Shopify、IKEA 及多数国际电商页支持 JSON-LD/OG 自动解析

## 安全说明

- `.env` 已加入 `.gitignore`，切勿提交令牌
- 工具仅调用官方开放 API（dev.wildberries.cn），请遵守 WB API 使用条款与限流规则
