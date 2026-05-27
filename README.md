# 个人网站（数字花园）基础版

这是一个基础版个人网站：用于把你筛选后的文章、博客与笔记（Markdown/MDX）集中到一个“公开数字花园”里。

## 快速开始

1. 安装依赖
   - `npm install`
2. 本地启动
   - `npm run dev`

## 内容写作

### 博客/文章

放到：`src/content/blog/`

示例（MDX 更适合插入组件）：

```mdx
---
title: "标题"
description: "一句话简介"
pubDate: "2026-05-21"
tags: ["tag1", "tag2"]
audio:
  src: "https://example.com/audio.mp3"
  title: "可选：音频标题"
---
```

### 花园笔记

放到：`src/content/garden/`

更适合碎片化、可持续修订的页面。

## 音频内容

有两种方式：

1. 在 frontmatter 里写 `audio.src`，文章页会自动显示播放器。
2. 使用 MDX 直接插入组件：
   - `import AudioPlayer from "../../components/AudioPlayer.astro";`
   - `<AudioPlayer src="..." title="..." />`

## 站点信息

`astro.config.mjs` 里的 `site` 先是占位 `https://example.com`，你部署前记得改成自己的域名。

