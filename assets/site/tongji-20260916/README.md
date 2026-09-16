# 同济网建筑铅笔底纹 · 2026-09-16

三幅原图使用 Workflow 的 Azure OpenAI 凭据，通过 `/openai/v1/images/edits`、`gpt-image-2.5-flare`、high quality 生成。模型实际接收了参考照片；原生 PNG 字节、请求和响应均保留，未切换模型。`*-response.json` 记录原图尺寸、SHA-256 和请求 ID；原图发布在下方 CDN 的 `originals/` 目录。

## 形态核对

- 页头：依据从黄浦江对岸拍摄的陆家嘴实景，保留东方明珠双大球、支撑及尖塔，金茂层叠塔冠，环球金融中心顶部开口，已建成的上海中心轮廓。
- 页脚：四平路 1239 号图书馆入口裙房、重复折线窗格的上部立面；照片未包含的屋顶以淡出处理。国立柱、水杉为校园素材组合，不表示实际相邻关系。没有将逸夫楼当作图书馆。
- 后台：国立柱的方形柱身、阶台、宽方形横额与叠层雕刻柱头；参照 2006 年全身照片及另一张柱头特写。枝叶参照水杉（Metasequoia glyptostroboides），保留细小羽状枝叶。
- [图书馆官方介绍](https://www.lib.tongji.edu.cn/index.php?classid=12115)确认四平路馆建于 1990 年。照片作者、许可、文件 SHA-256 见 [sources.json](sources.json)。

## 旧图与交付

R2 桶为 `tongjinet`，域名为 `https://t.no.mt`。旧前缀仅有 10 个图片对象，详见 [legacy-r2-inventory.json](legacy-r2-inventory.json)：

| 用途 | R2 key | 原尺寸 |
|---|---|---|
| 旧导航 | `ellie/bg-menu-light.jpg`、`bg-menu-light2.jpg` | 471 × 200 |
| 早期页脚 | `ellie/bg_footer_light_01.jpg`、`bg_footer_dark_01.jpg` | 2846 × 1504 |
| 当前页脚 | `ellie/Bg-shanghai-light.png`、`Bg-shanghai-dark.png` | 1423 × 752 |
| 当前帆船文字标志 | `ellie/Logo-light-2.png`、`Logo-dark-2.png` | 600 × 200 |
| 早期文字标志 | `ellie/Logo-light.jpg`、`Logo-dark.jpg` | 原版 JPG |

旧导航采用浓黑的密集城市速写；新图继承页脚的细线建筑素描风格。帆船文字标志和后台大象保留原有造型。仅对已知旧默认 URL 做显示层替换，自定义 URL 和空值保留；没有修改 D1 设置。

所有新素材使用独立路径 `https://t.no.mt/ellie/site/1.10.1/`，旧对象不覆盖。73 个交付文件包含：

- 三幅底纹的浅色/深色透明 WebP、多尺寸 JPG、最大尺寸透明 PNG。
- 帆船文字标志的 120/240/360/600 px 宽度 WebP、JPG 与最大尺寸 PNG。
- 原大象前景的 24/48/96/192/384/768 px WebP、JPG 与最大尺寸 PNG；Next.js 的 favicon/Apple/OG 文件继续遵循既有文件约定。

[manifest.json](manifest.json)逐项记录 URL、格式、透明通道、尺寸、字节数和 SHA-256。JPG 使用相应浅/深背景平铺，不伪称透明。UI 使用透明 WebP，`srcset`/`image-set` 选择尺寸；CSS 控制主题、渐变和局部占位，底纹不捕获交互，在强制对比度模式隐藏。

## 重建

将原图置于 `reference/artwork/tongji-20260916/{header,footer,admin}/original.png`，请求记录放回对应目录，旧 logo 放入 `legacy/`。执行：

```sh
uv run --with pillow python scripts/prepare-site-art.py
```

脚本不发出网络请求。输出在该研究目录的 `delivery/`；不会改写原图。铅笔层从亮度提取 alpha，缩放后恢复单一灰蓝色以消除透明边缘杂色，保留 64 级 alpha；常规/高清 WebP 约 12–21 KB / 51–82 KB。

`generate.py` 为本次实际采用的参考图请求脚本。须通过 Workflow 的 `direnv exec` 加载凭据；相同请求目录不能重复生成。提示词及去密请求/响应与本文件一起归档。三幅底纹的公开参考署名与衍生许可见 [credits.html](credits.html)；品牌标志不包含在 CC BY-SA 许可内。
