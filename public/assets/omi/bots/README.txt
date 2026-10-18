Omi · Bots 正式头像资源

4 种轮廓 × 8 种表情 × 线框/填充 2 款 × 彩色/黑/白/currentColor 4 版。
animated/：256 个透明动画 SVG；static/：256 个静态 SVG。
所有轮廓保留右下缺口；填充款表情使用对比色，主体外部仍透明。
动画包括左右看、眨眼、摇晃和浮动，支持 prefers-reduced-motion。

文件名：omi-{shape}-{expression}-{outline|filled}-{color|black|white|current}.svg
详细分类见 manifest.json。
网页资源路径示例：/assets/omi/bots/animated/omi-circle-joyful-filled-color.svg
外部图片建议通过 picture 配合 static/ 目录响应减少动态效果。
currentColor 版用于内联；填充款可用 --omi-face-color 自定义表情颜色。

应用内 BotAvatar 通过共享 Omi 组件使用同源矢量，保留主题配色、稳定身份、
离屏暂停和减少动态效果，并保留用户自定义头像。正式头像不引用 build/ 文件。

源文件：design/omnicode-brand-v10/animated/、expressions-8/、bot-avatars/shapes.json。
更新应用矢量：python scripts/generate-omnicode-artwork.py
更新本目录及预览包：node design/omnicode-brand-v10/bot-avatars/package.mjs
