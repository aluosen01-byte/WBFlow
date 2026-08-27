# WBFlow · WB（Wildberries中国）前台一键搬品

把**任意平台的商品**一键搬到 Wildberries 中国站（seller.wildberries.cn）的自动化工具。
粘贴源商品链接或手动填写商品信息，选择WB类目、补全特性，工具自动完成：**下载图片、创建商品卡片、上传图片、设置价格、设置库存**。

## 功能

- **源商品解析**：支持任意电商商品页（Open Graph / JSON-LD Product 协议），WB 商品页尽力解析；被反爬的站点（淘宝/京东/1688 等）可切换**手动输入**模式
- **WB类目与特性**：实时拉取官方类目树与子类目特性（中文），必填/变体/多值标注，重量尺寸类特性自动映射为包装尺寸（kg/cm）
- **品牌与SKU**：按类目拉取品牌候选，商家SKU留空自动生成
- **一键搬品**：全自动执行建卡、传图、定价、库存六步流水线，实时进度展示
- **搬品历史**：任务持久化，可回看每一步结果与失败原因（俄语错误自动翻译为中文提示）
- **令牌安全**：令牌存放于 `.env`（已 gitignore），服务端统一鉴权

## 版本号与发布

- 版本号以 `package.json` 为唯一版本源，格式 `x.y.z`
- **`npm run bump`**：每次代码修改后运行，版本号自动 +1（同步扩展 `manifest.json`）
- **`npm run package`**：打包 `dist/wbflow-extension-v1.0.0.zip` 与全项目 zip，并**自动解压覆盖 `dist/wbflow-extension/`**（Chrome 加载扩展所用的目录，免手动解压）
- **`npm run release`** = `npm run bump` + `npm run package`（一次完成版本递增与发布打包）
- 版本号展示：网页顶部与扩展"一键搬品"弹窗（`v1.1.2`，来自 `/api/version`）
- 后端提供 `GET /api/version` 返回 `{ name, version }`

## 快速开始

```bash
# 1. 安装依赖（Node.js 18+）
npm install

# 2. 配置令牌（单用户或多用户）
#    复制 .env.example 为 .env
#    单用户：WB_TOKEN=你的令牌
#    团队多用户：WB_USERS={"用户名1":"令牌1","用户名2":"令牌2",...}
#    令牌需包含 Content（商品管理）权限，建议同时开通 Prices、Marketplace 权限

# 3. 启动
npm start
# 打开 http://localhost:3000
```

## 团队多用户（使用前选择账号，支持切换）

- **后端**：`.env` 中 `WB_USERS` 配置团队所有用户令牌（JSON），服务端按请求头 `X-WB-User` 切换账号令牌，令牌只存服务端
- **网页界面**：顶部账号下拉选择当前操作账号（罗世凯 / 罗世伟 / …），切换后刷新该账号的额度、仓库、类目与搬品
- **浏览器扩展**：搬品弹窗右上角账号下拉，切换后搬品使用该账号令牌建卡
- **服务令牌**：若某用户令牌为服务令牌（`"for":"asid:*"`，如罗世伟），调用内容API需 `X-Client-Secret`，可在 `WB_USERS` 中用 `{"用户名":{"token":"...","clientSecret":"..."}}` 配置；未配置时该用户状态会提示"X-Client-Secret is required"，可改用个人令牌

## 浏览器扩展：WB商品页「一键搬品」按钮

在 **www.wildberries.ru / wildberries.cn 的商品详情页**（如 `https://www.wildberries.ru/catalog/1455302318/detail.aspx`）右下角自动注入「一键搬品」按钮，点击后在页内弹窗完成整条搬品链路：

1. **自动提取商品**：分层提取器（JSON-LD Product、OG/meta、DOM、__NUXT__ 正则兜底）抓取标题/品牌/价格/图片/描述/附加属性，全部可编辑；标题优先级 JSON-LD name → h1 → og:title（自动清理站点后缀），避免被 og:title 污染
2. **搬全部主图**：多来源合并提取所有主图（JSON-LD + og + DOM + __NUXT__ 去重，上限 30 张），WB 图片 URL 自动归一化为 big 全尺寸
3. **类目自动提取与匹配**：类目来源优先级 JSON-LD 面包屑 → DOM 面包屑导航 → __NUXT__ 父/子类目名；自动选中优先级：源类目学习映射 → **源类目路径规则表**（如 Sports/Cycling/Accessories → 体育用品/自行车装饰）→ 上次使用类目 → 默认类目
4. **尺寸与重量自动提取**：从 __NUXT__ dimensions → JSON-LD additionalProperty → DOM 特性区块提取长/宽/高（cm）与重量（kg），弹窗内可编辑并随搬品提交为包装尺寸
5. **描述抓取 Full Details 弹窗**：自动点击商品页"全部详情/Full details"弹窗抓取完整描述作为商品描述上传（页面描述容器与 __NUXT__ 兜底）
6. **品牌非必填**：留空即可（实测 WB 允许空品牌建卡）
7. **定价库存**：售价自动带出源商品价格（手动按汇率调整），**仓库默认选中"我的仓库"**（无则选第一个），库存一键配置
8. **后端自动启动**：Native Messaging Host 模式，打开扩展设置或商品页时若后端未运行自动在后台拉起，免手动 npm start
9. **团队多用户**：使用前选择账号（弹窗右上角下拉），搬品使用所选账号令牌，支持随时切换
10. **执行搬品**：实时显示六步进度，成功后给出 nmID 与卖家后台链接

### 安装扩展（zip 包方式，适合团队分发）

1. 从 `dist/` 目录下载 `wbflow-extension-v1.0.0.zip`，**解压到本地文件夹**（Chrome 不支持直接加载 zip）
2. 打开 Chrome / Edge，地址栏输入 `chrome://extensions` 回车
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择刚才解压出来的 `wbflow-extension/` 文件夹
5. 浏览器工具栏出现扩展图标（紫色 WB 方块）；若被折叠，点击拼图图标固定到工具栏
6. **启用后端自动启动（免手动 npm start）**：运行解压目录下 `wbflow-extension/native-host/install-host.bat`，
   注册 Native Messaging Host；之后打开扩展设置或商品页时，后端未运行会自动在后台启动
7. 点击扩展图标打开设置弹窗（此时后端应显示"已就绪"）：
   - 后端地址默认 `http://localhost:3000`；团队共用同一后端时改为服务器地址
   - 可配置默认仓库、价格策略、默认库存
8. 打开任意 WB 商品详情页，页面右下角出现「一键搬品」悬浮按钮

### 常见问题排查

| 现象 | 原因与处理 |
|---|---|
| 工具栏没有扩展图标 | 扩展未加载：检查 `chrome://extensions` 列表中是否有「WBFlow 一键搬品」；有则点拼图图标固定；无则按上面步骤加载 |
| 商品页没有悬浮按钮 | 确认当前是商品详情页（URL 含 `/catalog/数字/detail.aspx`）；页面需刷新一次（扩展刚加载后）；确认扩展处于启用状态 |
| 点按钮提示连不上后端 | 检查后端是否运行（`npm start`）、设置弹窗中的后端地址是否正确 |
| 搬品报"品牌问题" | 品牌需为该账号在 WB 卖家后台已注册的品牌 |

> 扩展源码位于 `wbflow-extension/`（Manifest V3，无第三方依赖）。集成测试见 `docs_ref/test-extension.mjs`（jsdom 模拟 WB 页面，验证提取/映射/提交/结果全流程）。

## 界面流程

1. **源商品**：粘贴商品链接，点「解析商品」查看解析结果（标题/图片/价格/品牌）；或切到「手动输入」直接填
2. **WB目标配置**：选父级类目、子类目，自动加载特性表单并尝试用源商品属性预填，填品牌（下拉候选）与商家SKU
3. **定价与库存**：售价、折扣、仓库（自动列出）、库存数量
4. **一键搬品**：点击后实时显示六步进度与最终卡片编号（nmID）和后台链接

## 技术架构

```
WBFlow/
├── server/
│   ├── index.js            # Express 入口（静态前台 + API + CORS + 健康检查）
│   ├── config.js           # 配置（.env 加载、网关地址、数据目录）
│   ├── wbClient.js         # WB API 客户端（统一鉴权/错误解析/429与5xx重试）
│   ├── contentApi.js       # 内容API：类目/特性/品牌/字典/建卡/传图/条码/卡片查询
│   ├── marketplaceApi.js   # 市场与定价API：仓库/库存/价格任务
│   ├── sourceFetcher.js    # 源商品解析器（JSON-LD/OG/meta + WB页面 + 手动）
│   ├── migrateService.js   # 一键搬品编排（六步流水线、错误翻译、同步等待）
│   └── routes.js           # REST 路由
├── public/                 # 前台（原生JS单页，无构建步骤）
├── wbflow-extension/       # Chrome/Edge 扩展（WB商品页注入"一键搬品"按钮）
│   ├── manifest.json       #   MV3 清单（固定扩展ID，含 nativeMessaging 权限）
│   ├── content.js          #   页内按钮 + 分层商品提取（类目/尺寸重量/主图）+ 搬品弹窗
│   ├── content.css         #   注入样式
│   ├── background.js       #   配置存取 + 后端自动启动（native host）
│   ├── popup.html/js       #   设置弹窗（后端地址/价格策略/仓库）
│   ├── native-host/        #   后端自动启动宿主（install-host.bat 一键注册）
│   └── icons/
├── dist/                   # 分发压缩包（扩展zip / 全项目zip）
└── docs_ref/               # 离线接口文档与提取/分析/测试脚本（开发参考）
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

- **浏览器扩展模式**（推荐）：在 WB 商品页内直接提取页面数据，不受服务器反爬限制
- WB前台（wildberries.cn / wildberries.ru）对服务器请求有反爬，URL解析为尽力而为；失败时请用**手动输入**
- 淘宝/天猫/京东/1688/拼多多等国内平台反爬严格，建议手动输入
- Shopify、IKEA 及多数国际电商页支持 JSON-LD/OG 自动解析

## 安全说明

- `.env` 已加入 `.gitignore`，切勿提交令牌
- 工具仅调用官方开放 API（dev.wildberries.cn），请遵守 WB API 使用条款与限流规则
