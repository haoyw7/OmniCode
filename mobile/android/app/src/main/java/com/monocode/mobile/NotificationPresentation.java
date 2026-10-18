package com.monocode.mobile;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Notification-only formatting; saved titles and provider text remain intact. */
final class NotificationPresentation {
    // Match sessionDisplayTitle / HARNESS_TITLE on the web side.
    static String displayTitle(String title, String harness, String newSession) {
        if (title == null || title.isEmpty()) return "OmniCode";
        String name;
        switch (harness == null ? "" : harness) {
            case "claude": name = "Claude Code"; break;
            case "codex": name = "Codex"; break;
            case "cursor": name = "Cursor"; break;
            case "grok": name = "Grok Build"; break;
            case "opencode": name = "OpenCode"; break;
            case "pi": name = "Pi"; break;
            case "omp": name = "omp"; break;
            case "fx": name = "fx"; break;
            case "hermes": name = "Hermes Agent"; break;
            case "antigravity": name = "Antigravity"; break;
            default: return title;
        }
        String prefix = harness + " · ";
        if (title.startsWith(prefix)) {
            String display = title.substring(prefix.length());
            return display.isEmpty() ? "OmniCode" : display;
        }
        return title.equals(harness) || title.equals(name) ? newSession : title;
    }

    /** Keep in sync with src/mobile/notificationText.ts, including literal protection. */
    static String plainText(String value) {
        if (value == null || value.isEmpty()) return "";
        List<String> literals = new ArrayList<>();
        Function<String, String> protect = text -> {
            literals.add(text);
            return "\0" + (literals.size() - 1) + "\0";
        };
        String text = value.replace("\0", "").replaceAll("\r\n?", "\n");
        text = replace(text, "(^|\n)\\s*(`{3,}|~{3,})[^\n]*\n([\\s\\S]*?)(?:\n\\s*\\2\\s*(?=\n|$)|$)",
            match -> match.group(1) + protect.apply(match.group(3)));
        text = replace(text, "(`+)([^`]+?)\\1", match -> protect.apply(match.group(2)));
        text = replace(text, "\\\\([\\\\`*{}\\[\\]()#+.!_>~|\\-])", match -> protect.apply(match.group(1)));
        text = text.replaceAll("(?m)^\\s{0,3}\\[[^\\]\n]+\\]:\\s+\\S+.*$", "")
            .replaceAll("!?(\\[([^\\]\n]*)\\])\\((?:[^()\n]|\\([^()\n]*\\))*\\)", "$2")
            .replaceAll("!?\\[([^\\]\n]+)\\]\\[[^\\]\n]*\\]", "$1")
            .replaceAll("<(https?://[^>\\s]+|[^<>\\s]+@[^<>\\s]+)>", "$1")
            .replaceAll("(?m)^\\s{0,3}(?:(?:\\*\\s*){3,}|(?:-\\s*){3,}|(?:_\\s*){3,}|=+)\\s*$", "")
            .replaceAll("(?m)^\\s*\\|?[ \t]*:?-{3,}:?[ \t]*(?:\\|[ \t]*:?-{3,}:?[ \t]*)+\\|?\\s*$", "");
        text = replace(text, "(?m)^[ \t]*\\|(.+)\\|[ \t]*$", match -> match.group(1).replace('|', ' '))
            .replaceAll("(?m)^\\s{0,3}(?:>\\s*)+", "")
            .replaceAll("(?m)^[ \t]{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$", "$1")
            .replaceAll("(?m)^\\s*(?:[-+*]|\\d+[.)])\\s+(?:\\[[ xX]\\]\\s+)?", "")
            .replaceAll("\\*\\*(\\S(?:[\\s\\S]*?\\S)?)\\*\\*", "$1")
            .replaceAll("\\*(\\S(?:[\\s\\S]*?\\S)?)\\*", "$1")
            .replaceAll("(^|\\W)__(\\S(?:[\\s\\S]*?\\S)?)__(?=\\W|$)", "$1$2")
            .replaceAll("(^|\\W)_(\\S(?:[\\s\\S]*?\\S)?)_(?=\\W|$)", "$1$2")
            .replaceAll("~~(\\S(?:[\\s\\S]*?\\S)?)~~", "$1");
        if (text.endsWith("…")) text = text.replaceAll("(^|\\s)(?:\\*{1,3}|_{1,3}|~~|`+)(?=\\S)", "$1");
        return replace(text, "\0(\\d+)\0", match -> literals.get(Integer.parseInt(match.group(1))))
            .replaceAll("\\s+", " ").trim();
    }

    private static String replace(String value, String pattern, Function<Matcher, String> replacement) {
        Matcher matcher = Pattern.compile(pattern).matcher(value);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) matcher.appendReplacement(result, Matcher.quoteReplacement(replacement.apply(matcher)));
        matcher.appendTail(result);
        return result.toString();
    }
}
