import type { HarnessBotCapabilities } from "../src/integrations/harness/core/botContext";
import { providerBotCapabilities } from "../src/integrations/harness/providers/botCapabilities";
import type { NativeTitleInput } from "../src/integrations/harness/core/titleCoordinator";
import { readFamilySessionTitle } from "../src/integrations/harness/providers/pi/piFamily";
import * as codex from "../src/integrations/harness/providers/codex/codex";
import * as claude from "../src/integrations/harness/providers/claude/claude";
import * as cursor from "../src/integrations/harness/providers/cursor/cursor";
import * as grok from "../src/integrations/harness/providers/grok/grok";
import * as opencode from "../src/integrations/harness/providers/opencode/opencode";
import * as pi from "../src/integrations/harness/providers/pi/pi";
import * as omp from "../src/integrations/harness/providers/omp/omp";
import * as fx from "../src/integrations/harness/providers/fx/fx";
import * as hermes from "../src/integrations/harness/providers/hermes/hermes";
import * as antigravity from "../src/integrations/harness/providers/antigravity/antigravity";
import type {
  SendTurnInput,
  CompactContextInput,
  SteerTurnInput,
  ApprovalDecision,
} from "../src/integrations/harness/core/types";
import type { UserQuestionReply } from "../src/features/sessions/model/userQuestion";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import type { NativeCommandProvider } from "../src/integrations/harness/core/nativeCommands";
import { discoverPiCommands } from "../src/integrations/harness/providers/pi/piSkills";
import { ompCommandProvider } from "../src/integrations/harness/providers/pi/piFamily";
import { generateCodexBranchName } from "../src/integrations/harness/providers/codex/codexGit";
import { generateClaudeBranchName } from "../src/integrations/harness/providers/claude/claudeGit";
import { generateCursorBranchName } from "../src/integrations/harness/providers/cursor/cursorGit";
import { generateGrokBranchName } from "../src/integrations/harness/providers/grok/grokGit";
import { generateOpenCodeBranchName } from "../src/integrations/harness/providers/opencode/opencodeGit";
import { runPiTextPrompt, runOmpTextPrompt } from "../src/integrations/harness/providers/pi/piText";
import { generateTextBranchName } from "../src/integrations/harness/core/branchName";
import {
  PI_FLAVOR,
  OMP_FLAVOR,
} from "../src/integrations/harness/providers/pi/piFlavor";
import { respondQuestion as respondPiQuestion } from "../src/integrations/harness/providers/pi/piFamily";

export interface HostProvider {
  botCapabilities?: HarnessBotCapabilities;
  commands?: NativeCommandProvider;
  readSessionTitle?(input: NativeTitleInput): Promise<string | null>;
  send(input: SendTurnInput): Promise<void>;
  compact?(input: CompactContextInput): Promise<void>;
  steer?(input: SteerTurnInput): Promise<void>;
  cancel(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  bind(
    id: string,
    providerId: string,
    cwd: string,
    providerAccountId?: string,
    nativeSession?: import("../src/features/sessions/model/session").NativeSessionLink,
  ): void;
  approve(id: string, request: number, decision: ApprovalDecision): void;
  answer(id: string, request: number, reply: UserQuestionReply): void;
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
}

export const hostProviders: Record<RemoteProvider, HostProvider> = {
  codex: {
    botCapabilities: providerBotCapabilities("codex"),
    readSessionTitle: codex.readCodexSessionTitle,
    send: codex.sendCodexTurn,
    steer: codex.steerCodexTurn,
    compact: codex.compactCodexContext,
    cancel: codex.cancelCodexTurn,
    stop: codex.forgetCodexSession,
    bind: codex.bindCodexSession,
    approve: codex.respondCodexApproval,
    answer: codex.respondCodexQuestion,
    generateBranchName: generateCodexBranchName,
  },
  claude: {
    botCapabilities: providerBotCapabilities("claude"),
    readSessionTitle: claude.readClaudeSessionTitle,
    send: claude.sendClaudeTurn,
    steer: claude.steerClaudeTurn,
    compact: claude.compactClaudeContext,
    cancel: claude.cancelClaudeTurn,
    stop: claude.forgetClaudeSession,
    bind: claude.bindClaudeSession,
    approve: claude.respondClaudeApproval,
    answer: claude.respondClaudeQuestion,
    generateBranchName: generateClaudeBranchName,
  },
  cursor: {
    botCapabilities: providerBotCapabilities("cursor"),
    generateBranchName: generateCursorBranchName,
    readSessionTitle: cursor.readCursorSessionTitle,
    send: cursor.sendCursorTurn,
    steer: cursor.steerCursorTurn,
    cancel: cursor.cancelCursorTurn,
    stop: cursor.forgetCursorSession,
    bind: cursor.bindCursorSession,
    approve: cursor.respondCursorApproval,
    answer: cursor.respondCursorQuestion,
  },
  grok: {
    botCapabilities: providerBotCapabilities("grok"),
    generateBranchName: generateGrokBranchName,
    readSessionTitle: grok.readGrokSessionTitle,
    send: grok.sendGrokTurn,
    compact: grok.compactGrokContext,
    cancel: grok.cancelGrokTurn,
    stop: grok.forgetGrokSession,
    bind: grok.bindGrokSession,
    approve: grok.respondGrokApproval,
    answer: grok.respondGrokQuestion,
  },
  opencode: {
    botCapabilities: providerBotCapabilities("opencode"),
    generateBranchName: generateOpenCodeBranchName,
    readSessionTitle: opencode.readOpenCodeSessionTitle,
    send: opencode.sendOpenCodeTurn,
    steer: opencode.steerOpenCodeTurn,
    compact: opencode.compactOpenCodeContext,
    cancel: opencode.cancelOpenCodeTurn,
    stop: opencode.forgetOpenCodeSession,
    bind: opencode.bindOpenCodeSession,
    approve: opencode.respondOpenCodeApproval,
    answer: opencode.respondOpenCodeQuestion,
  },
  pi: {
    botCapabilities: providerBotCapabilities("pi"),
    generateBranchName: (cwd, message) => generateTextBranchName(runPiTextPrompt, cwd, message),
    commands: { rawSlashCommands: true, discover: ({ cwd }) => discoverPiCommands(cwd) },
    readSessionTitle: (input) => readFamilySessionTitle(PI_FLAVOR, input),
    send: pi.sendPiTurn,
    steer: pi.steerPiTurn,
    compact: pi.compactPiContext,
    cancel: pi.cancelPiTurn,
    stop: pi.forgetPiSession,
    bind: pi.bindPiSession,
    approve: pi.respondPiApproval,
    answer: (id, request, reply) =>
      respondPiQuestion(PI_FLAVOR, id, request, reply),
  },
  omp: {
    botCapabilities: providerBotCapabilities("omp"),
    generateBranchName: (cwd, message) => generateTextBranchName(runOmpTextPrompt, cwd, message),
    commands: ompCommandProvider,
    readSessionTitle: (input) => readFamilySessionTitle(OMP_FLAVOR, input),
    send: omp.sendOmpTurn,
    steer: omp.steerOmpTurn,
    compact: omp.compactOmpContext,
    cancel: omp.cancelOmpTurn,
    stop: omp.forgetOmpSession,
    bind: omp.bindOmpSession,
    approve: omp.respondOmpApproval,
    answer: (id, request, reply) =>
      respondPiQuestion(OMP_FLAVOR, id, request, reply),
  },
  fx: {
    botCapabilities: providerBotCapabilities("fx"),
    readSessionTitle: fx.readFxSessionTitle,
    send: fx.sendFxTurn,
    cancel: fx.cancelFxTurn,
    stop: fx.forgetFxSession,
    bind: fx.bindFxSession,
    approve: fx.respondFxApproval,
    answer: unsupportedQuestion,
  },
  hermes: {
    botCapabilities: providerBotCapabilities("hermes"),
    readSessionTitle: hermes.readHermesSessionTitle,
    send: hermes.sendHermesTurn,
    steer: hermes.steerHermesTurn,
    cancel: hermes.cancelHermesTurn,
    stop: hermes.forgetHermesSession,
    bind: hermes.bindHermesSession,
    approve: hermes.respondHermesApproval,
    answer: unsupportedQuestion,
  },
  antigravity: {
    botCapabilities: providerBotCapabilities("antigravity"),
    readSessionTitle: antigravity.readAntigravitySessionTitle,
    send: antigravity.sendAntigravityTurn,
    cancel: antigravity.cancelAntigravityTurn,
    stop: antigravity.forgetAntigravitySession,
    bind: antigravity.bindAntigravitySession,
    approve: antigravity.respondAntigravityApproval,
    answer: unsupportedQuestion,
  },
};

function unsupportedQuestion(): never {
  throw new Error("This provider does not support questions");
}
