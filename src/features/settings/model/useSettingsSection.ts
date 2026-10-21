import { useEffect, useState } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { loadSettingsSection, saveSettingsSection, SETTINGS_SECTIONS } from "./settings";

const parser = parseAsStringLiteral(SETTINGS_SECTIONS.map(section => section.id));

export function useSettingsSection() {
  const [fallback] = useState(loadSettingsSection);
  const [section, setSection] = useQueryState("settings", parser.withDefault(fallback).withOptions({ clearOnDefault: false }));
  useEffect(() => saveSettingsSection(section), [section]);
  return [section, setSection] as const;
}
