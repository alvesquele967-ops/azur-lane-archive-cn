# 碧蓝航线国服舰船图鉴

一款面向《碧蓝航线》国服玩家的 Windows 桌面资料库与收藏管理工具，基于 Electron、Vue 3 和 TypeScript 开发。所有个人收藏、预设与舰队数据均保存在本地，不登录或读取游戏账号。

[![Release](https://img.shields.io/github/v/release/alvesquele967-ops/azur-lane-archive-cn?display_name=tag)](https://github.com/alvesquele967-ops/azur-lane-archive-cn/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-x64-4c9bd6)](https://github.com/alvesquele967-ops/azur-lane-archive-cn/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

![动态舰船关系图谱](docs/screenshots/relationship-graph.png)

## 主要功能

- 舰船图鉴、改造图鉴、游戏收藏奖励、已拥有舰船和独立皮肤画廊。
- 内置 1004 条舰船与改造档案，包含属性、装备槽效率、技能、舰船科技、角色设定与台词等结构化资料。
- 内置 898 件装备、264 件特殊兵装、95 条海域掉落索引及资讯快照，支持按模块更新。
- 舰种、稀有度、阵营、获取方式等组合筛选；所有选择器均支持搜索。
- 单船点亮、批量全选/全不选，以及持久化撤销与重做（`Ctrl+Z` / `Ctrl+Y`）。
- 按相同活动、关卡或同期实装批次汇总尚未拥有的舰船。
- 动态关系图谱：自由平移、节点拖动、鼠标位置缩放、1%–800% 缩放范围和自动适应全部节点。
- 每艘舰船可保存多套装备预设；六槽舰队编成可保存、复制、调整位置并关联装备方案。
- 港区风格主页，可选择舰船或皮肤立绘并保存缩放与位置。
- 更新邮件中心：同步发现的新舰船、皮肤、装备、兵装、海域及资讯会生成本地摘要邮件。
- 每日定时更新、系统托盘后台运行和 Windows 新内容通知。
- 收藏、预设、舰队、设置和邮件状态支持导入、导出及 SQLite 完整备份。
- Wiki 图片可下载至本地缓存；下载过程校验真实图片格式，避免把拦截页面误存为图片。

## 下载

请从 [Releases](https://github.com/alvesquele967-ops/azur-lane-archive-cn/releases) 下载：

- `碧蓝航线舰船图鉴-1.3.4-x64-安装版.exe`：Windows 安装程序。
- `碧蓝航线舰船图鉴-1.3.4-绿色版.exe`：免安装便携版本。

项目暂未配置商业代码签名，Windows 首次运行时可能显示安全提醒。

## 数据来源与边界

- 舰船、角色、装备、兵装、地图与皮肤资料主要来自 Bilibili 托管的[碧蓝航线 BWIKI](https://wiki.biligame.com/blhx/)。BWIKI 内容由社区维护，并非游戏官方数据库。
- 活动开放、复刻和常驻调整等即时状态应以游戏内公告及[国服 Bilibili 游戏中心](https://www.biligame.com/detail/?id=97)为准。
- 应用不使用游戏账号、不读取游戏客户端数据，也不接入来源不明的私人接口。
- Wiki 资料和个人收藏严格分表保存，资料同步不会覆盖收藏、星级、装备预设或舰队预设。

## 本地开发

需要 Node.js 20 或更高版本。

```powershell
npm install
npm run typecheck
npm test
npm run build:web
npm run build:offline
```

刷新内置公开资料快照：

```powershell
npm run sync:data
node scripts/sync-wiki-module.mjs all data/wiki.json
```

如需指定 Electron 国内镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run build:offline
```

## 本地数据位置

- 安装版：Electron 用户数据目录。
- 绿色版：优先在 EXE 同目录创建 `碧蓝航线舰船图鉴数据`；目录不可写时回退到系统用户数据目录。

建议定期使用应用内的“导出完整资料”或“备份数据库”。这些本地文件和图片缓存均已从 Git 仓库排除。

## 免责声明

本项目是非官方玩家工具，与《碧蓝航线》开发商、发行商及 Bilibili 无隶属或授权关系。角色名称、图像和游戏资料的相关权利归各自权利人所有。本工具仅用于个人资料整理与收藏状态管理。

