import { defineConfig } from "vitepress";

const repository = "https://github.com/zhuyanlong0091-prog/brain-creator";

const englishTheme = {
  nav: [
    { text: "Get started", link: "/getting-started" },
    { text: "Guides", link: "/guides/requirement-to-test" },
    { text: "Reference", link: "/cli-reference" }
  ],
  sidebar: [
    {
      text: "Start",
      items: [
        { text: "Documentation home", link: "/" },
        { text: "Quickstart", link: "/getting-started" },
        { text: "Core concepts", link: "/core-concepts" }
      ]
    },
    {
      text: "Guides",
      items: [
        { text: "Requirement to test", link: "/guides/requirement-to-test" },
        { text: "Trusted control plane", link: "/guides/trusted-control-plane" },
        { text: "Storage and evidence", link: "/guides/storage-and-evidence" },
        { text: "Agent usage", link: "/agent-usage" },
        { text: "Session resume", link: "/e2e-session-resume-workflow" }
      ]
    },
    {
      text: "Reference",
      items: [
        { text: "CLI reference", link: "/cli-reference" },
        { text: "MCP installation", link: "/mcp-installation" },
        { text: "Troubleshooting", link: "/troubleshooting" },
        { text: "Release checklist", link: "/release-checklist" },
        { text: "Execution quality register", link: "/quality/problem-register" },
        { text: "Real-system regression samples", link: "/quality/real-system-regression" },
        { text: "Reliability controls", link: "/quality/reliability-controls" }
      ]
    }
  ],
  editLink: { pattern: `${repository}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
  docFooter: { prev: "Previous page", next: "Next page" },
  lastUpdated: { text: "Last updated" },
  outline: { label: "On this page" },
  returnToTopLabel: "Return to top",
  sidebarMenuLabel: "Menu",
  darkModeSwitchLabel: "Appearance",
  lightModeSwitchTitle: "Switch to light theme",
  darkModeSwitchTitle: "Switch to dark theme",
  langMenuLabel: "Change language",
  skipToContentLabel: "Skip to content",
  footer: {
    message: "Released under the MIT License.",
    copyright: "Brain Creator documentation"
  }
};

const chineseTheme = {
  nav: [
    { text: "开始使用", link: "/zh-CN/getting-started" },
    { text: "指南", link: "/zh-CN/guides/requirement-to-test" },
    { text: "参考", link: "/zh-CN/cli-reference" }
  ],
  sidebar: [
    {
      text: "开始",
      items: [
        { text: "文档首页", link: "/zh-CN/" },
        { text: "快速开始", link: "/zh-CN/getting-started" },
        { text: "核心概念", link: "/zh-CN/core-concepts" }
      ]
    },
    {
      text: "指南",
      items: [
        { text: "从需求到测试", link: "/zh-CN/guides/requirement-to-test" },
        { text: "可信控制面", link: "/zh-CN/guides/trusted-control-plane" },
        { text: "存储与证据", link: "/zh-CN/guides/storage-and-evidence" },
        { text: "Agent 使用", link: "/zh-CN/agent-usage" },
        { text: "恢复新会话", link: "/zh-CN/e2e-session-resume-workflow" }
      ]
    },
    {
      text: "参考",
      items: [
        { text: "CLI 参考", link: "/zh-CN/cli-reference" },
        { text: "MCP 安装", link: "/zh-CN/mcp-installation" },
        { text: "故障排查", link: "/zh-CN/troubleshooting" },
        { text: "发布清单", link: "/zh-CN/release-checklist" },
        { text: "真实系统回归样本", link: "/zh-CN/quality/real-system-regression" },
        { text: "执行可靠性控制", link: "/zh-CN/quality/reliability-controls" }
      ]
    }
  ],
  editLink: { pattern: `${repository}/edit/main/docs/:path`, text: "在 GitHub 上编辑此页" },
  docFooter: { prev: "上一页", next: "下一页" },
  lastUpdated: { text: "最后更新" },
  outline: { label: "本页内容" },
  returnToTopLabel: "返回顶部",
  sidebarMenuLabel: "菜单",
  darkModeSwitchLabel: "外观",
  lightModeSwitchTitle: "切换到浅色主题",
  darkModeSwitchTitle: "切换到深色主题",
  langMenuLabel: "切换语言",
  skipToContentLabel: "跳转到正文",
  footer: {
    message: "基于 MIT License 发布。",
    copyright: "Brain Creator 文档"
  }
};

export default defineConfig({
  title: "Brain Creator",
  description: "Requirement-driven, agent-native testing for Claude Code and Codex.",
  base: "/brain-creator/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: "https://zhuyanlong0091-prog.github.io/brain-creator/"
  },
  head: [
    ["link", { rel: "icon", type: "image/png", href: "/brain-creator/brain-creator-mark.png" }]
  ],
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: "Brain Creator",
      description: "Requirement-driven, agent-native testing for Claude Code and Codex.",
      themeConfig: englishTheme
    },
    "zh-CN": {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh-CN/",
      title: "Brain Creator",
      description: "面向 Claude Code 与 Codex 的需求驱动 Agent 原生测试业务脑。",
      themeConfig: chineseTheme
    }
  },
  themeConfig: {
    logo: "/brain-creator-mark.png",
    siteTitle: "Brain Creator",
    socialLinks: [{ icon: "github", link: repository }],
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "Search", buttonAriaLabel: "Search documentation" },
              modal: { noResultsText: "No results for" }
            }
          },
          "zh-CN": {
            translations: {
              button: { buttonText: "搜索", buttonAriaLabel: "搜索文档" },
              modal: {
                noResultsText: "没有找到相关结果",
                resetButtonTitle: "清除查询",
                backButtonTitle: "关闭搜索"
              }
            }
          }
        }
      }
    }
  }
});
