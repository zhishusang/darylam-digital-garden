import { defineCollection, z } from "astro:content";

const baseSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  pubDate: z.coerce.date().optional(),
  updatedDate: z.coerce.date().optional(),
  audio: z
    .object({
      src: z.string().url(),
      title: z.string().optional(),
    })
    .optional(),
});

const blog = defineCollection({
  type: "content",
  schema: baseSchema,
});

const garden = defineCollection({
  type: "content",
  schema: baseSchema.extend({
    // 花园笔记通常没有严格发布时间；允许缺省 pubDate。
  }),
});

const diary = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    place: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const goods = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    pubDate: z.coerce.date().optional(),
    updatedDate: z.coerce.date().optional(),
    link: z.string().url().optional(),
  }),
});

const foodie = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    pubDate: z.coerce.date().optional(),
    updatedDate: z.coerce.date().optional(),
    index: z.number().optional(),
    source: z.string().optional(),
  }),
});

const travel = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    pubDate: z.coerce.date().optional(),
    updatedDate: z.coerce.date().optional(),
    source: z.string().optional(),
    place: z.string().optional(),
  }),
});

// // “巨人的兵器”同步栏目：从 Obsidian 目录同步过来后再发布
const weapons = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    pubDate: z.coerce.date().optional(),
    updatedDate: z.coerce.date(), // 完美承接你在 Obsidian 里写的 updatedDate
    source: z.string().optional(),
  }),
});

// 📌 核心关键：必须把所有定义的模块统一在这里导出映射
export const collections = {
  blog,
  garden,
  diary,
  goods,
  foodie,
  travel,
  weapons, // 激活传送门
};
