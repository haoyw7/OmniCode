package com.omnicode.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationPresentationTest {
    @Test public void removesOnlyTheMatchingStoredPrefixAndLocalizesUntitledSessions() {
        assertEquals("codex 使用说明", NotificationPresentation.displayTitle("codex · codex 使用说明", "codex", "新会话"));
        assertEquals("claude · 用户标题", NotificationPresentation.displayTitle("claude · 用户标题", "codex", "新会话"));
        assertEquals("codex 使用说明", NotificationPresentation.displayTitle("codex 使用说明", "codex", "新会话"));
        assertEquals("新会话", NotificationPresentation.displayTitle("Codex", "codex", "新会话"));
        assertEquals("新会话", NotificationPresentation.displayTitle("codex", "codex", "新会话"));
        assertEquals("Title", NotificationPresentation.displayTitle("Title", null, "New session"));
        assertEquals("custom · Title", NotificationPresentation.displayTitle("custom · Title", "custom", "New session"));
        assertEquals("OmniCode", NotificationPresentation.displayTitle("", "codex", "New session"));
    }

    @Test public void rendersMarkdownWithoutLosingCodePathsOrLiteralPunctuation() {
        String[][] examples = {
            {"**实际增量拉取成功。** 已确认 byn，UID 为 `23358`。", "实际增量拉取成功。 已确认 byn，UID 为 23358。"},
            {"# 结果\n> **成功**\n- [x] 完成\n1. _测试_ ~~旧值~~", "结果 成功 完成 测试 旧值"},
            {"[文档](https://example.com/a_(b)) ![预览](image.png) [详情][ref]\n[ref]: https://example.com", "文档 预览 详情"},
            {"```sh\necho **/*.ts && echo $HOME\n```\n`a_b * 2`", "echo **/*.ts && echo $HOME a_b * 2"},
            {"user_name /tmp/a-b.ts #123 2 > 1 <user> \\*literal\\*", "user_name /tmp/a-b.ts #123 2 > 1 <user> *literal*"},
            {"**截断的回复…", "截断的回复…"},
            {"**粗体 *嵌套* 内容** 和 *斜体 **嵌套** 内容*", "粗体 嵌套 内容 和 斜体 嵌套 内容"},
            {"| 项目 | 结果 |\n| --- | :---: |\n| `a|b` | **通过** |", "项目 结果 a|b 通过"},
            {"## 标题 ##\n保留末尾 #", "标题 保留末尾 #"},
            {"---\n***\n___", ""}
        };
        for (String[] example : examples) assertEquals(example[0], example[1], NotificationPresentation.plainText(example[0]));
        assertEquals("", NotificationPresentation.plainText(null));
    }
}
