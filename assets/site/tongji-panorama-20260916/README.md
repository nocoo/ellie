# 同济网横向底纹 · 2026-09-16

v1.10.1 的底纹相对浏览器右边缘定位，偏高的图幅在矮页头里缩小，宽屏上与正文脱离。v1.10.2 为页头和页脚增加与正文共用 `.width-container` 的装饰容器；画面围绕容器横向中心稍偏右铺开。固定宽度、全宽模式及即时宽度切换均使用同一条布局规则。手机展示主要地标所在区域；双主题、透明渐变、鼠标穿透和强制对比度支持继续保留。

两幅图通过 Workflow 的 `/openai/v1/images/edits`、`gpt-image-2.5-flare`、high quality 扩绘，模型实际接收第一版原图和实景照片。原生输出均为 **3072 × 1024**，完整 PNG/C2PA 字节保存在 `originals/`，没有用拉伸代替绘制。提示词期望的窄条仅作为构图指导；实际交付裁切按生成图检查，保留完整塔尖和树冠：页头为 3072 × 640，页脚为 3072 × 784。只去除多余纸面、水面和前景留白，建筑保持等比。

## 素材与署名

- CDN：`https://t.no.mt/ellie/site/1.10.2/`，R2 桶 `tongjinet`。
- 两幅底纹各有浅/深主题、768/1536/3072 宽度的透明 WebP 和 JPG，以及最高分辨率透明 PNG，共 28 个交付图片。
- 网页按 1x/2x 使用 768/1536 像素版本；3072 像素版本及原图保留供后续使用。
- 标志与后台底纹继续使用 1.10.1 的已优化素材。
- 第一版默认页脚 URL 在显示层解析到新图；自定义 URL 和空值保持原样，没有修改 D1 设置。
- [sources.json](sources.json)记录真实照片与第一版原图来源；[credits.html](credits.html)提供署名和 CC BY-SA 4.0 衍生许可。

## 重建

将两幅原生 PNG、请求和响应记录放入 `reference/artwork/tongji-panorama-20260916/{header,footer}/`，执行：

```sh
uv run --with pillow python scripts/prepare-site-art.py --panorama
```

生成使用第一版归档的 [generate.py](../tongji-20260916/generate.py)，本次增加 `3072x1024` 原生尺寸选项。每个请求目录只生成一次，原始输出不改写。导出全部完成后再冻结文件、上传新 R2 路径，避免上传未完成文件；交付哈希和尺寸见 [manifest.json](manifest.json)。
