/** Default chrome glyphs. Platform artwork is supplied through IconArtworkContext. */
import {
  AudioLines as AudioLinesIcon,
  Bell as BellIcon,
  MoreVertical as MoreVerticalIcon,
  SquarePen as SquarePenIcon,
  SunMoon as SunMoonIcon,
  UserRound as UserRoundIcon,
  Vibrate as VibrateIcon,
  Volume2 as Volume2Icon,
  AlertCircle as AlertCircleIcon,
  AppWindow as AppWindowIcon,
  Archive as ArchiveIcon,
  ArrowDownCircle as ArrowDownCircleIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ArrowUp as ArrowUpIcon,
  BellOff as BellOffIcon,
  Bot as BotIcon,
  CalendarDays as CalendarDaysIcon,
  CameraOff as CameraOffIcon,
  CaseSensitive as CaseSensitiveIcon,
  ChartNoAxesCombined as ChartNoAxesCombinedIcon,
  Check as CheckIcon,
  CheckCheck as CheckCheckIcon,
  CheckCircle as CheckCircleIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronUp as ChevronUpIcon,
  ChevronsUpDown as ChevronsUpDownIcon,
  CircleAlert as CircleAlertIcon,
  CircleDashed as CircleDashedIcon,
  CircleDot as CircleDotIcon,
  CircleHelp as CircleHelpIcon,
  CircleStop as CircleStopIcon,
  CircleX as CircleXIcon,
  Clock as ClockIcon,
  CloudUpload as CloudUploadIcon,
  Code as CodeIcon,
  CodeXml as CodeXmlIcon,
  Copy as CopyIcon,
  CornerDownRight as CornerDownRightIcon,
  CornerDownLeft as CornerDownLeftIcon,
  Earth as EarthIcon,
  ExternalLink as ExternalLinkIcon,
  Eye as EyeIcon,
  File as FileIcon,
  FileCode as FileCodeIcon,
  FileDiff as FileDiffIcon,
  FileInput as FileInputIcon,
  FilePlus as FilePlusIcon,
  FilePlusCorner as FilePlusCornerIcon,
  FoldVertical as FoldVerticalIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  FolderPlus as FolderPlusIcon,
  FolderTree as FolderTreeIcon,
  Gauge as GaugeIcon,
  GitBranch as GitBranchIcon,
  GitCompare as GitCompareIcon,
  GitMerge as GitMergeIcon,
  GitPullRequest as GitPullRequestIcon,
  GitPullRequestClosed as GitPullRequestClosedIcon,
  GitPullRequestDraft as GitPullRequestDraftIcon,
  Globe as GlobeIcon,
  GripVertical as GripVerticalIcon,
  Home as HomeIcon,
  ImagePlus as ImagePlusIcon,
  Inbox as InboxIcon,
  Keyboard as KeyboardIcon,
  Laptop as LaptopIcon,
  Lightbulb as LightbulbIcon,
  Link as LinkIcon,
  List as ListIcon,
  ListChecks as ListChecksIcon,
  Download as DownloadIcon,
  ListEnd as ListEndIcon,
  ListFilter as ListFilterIcon,
  LoaderCircle as LoaderCircleIcon,
  Lock as LockIcon,
  Smartphone as SmartphoneIcon,
  Split as SplitIcon,
  Maximize2 as Maximize2Icon,
  MessageSquare as MessageSquareIcon,
  MessageSquarePlus as MessageSquarePlusIcon,
  MessagesSquare as MessagesSquareIcon,
  Minus as MinusIcon,
  Monitor as MonitorIcon,
  MoreHorizontal as MoreHorizontalIcon,
  MousePointer2 as MousePointer2Icon,
  MoveLeft as MoveLeftIcon,
  MoveRight as MoveRightIcon,
  Palette as PaletteIcon,
  PanelBottom as PanelBottomIcon,
  PanelLeft as PanelLeftIcon,
  PanelRight as PanelRightIcon,
  PanelTop as PanelTopIcon,
  Pause as PauseIcon,
  PenLine as PenLineIcon,
  Pencil as PencilIcon,
  Pin as PinIcon,
  PinOff as PinOffIcon,
  Pipette as PipetteIcon,
  Play as PlayIcon,
  Plus as PlusIcon,
  RefreshCw as RefreshCwIcon,
  WrapText as WrapTextIcon,
  Regex as RegexIcon,
  Replace as ReplaceIcon,
  RectangleEllipsis as RectangleEllipsisIcon,
  RotateCcw as RotateCcwIcon,
  ScanQrCode as ScanQrCodeIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Share as ShareIcon,
  Shield as ShieldIcon,
  SlidersHorizontal as SlidersHorizontalIcon,
  Sparkles as SparklesIcon,
  Square as SquareIcon,
  SquareDashedMousePointer as SquareDashedMousePointerIcon,
  SquarePlus as SquarePlusIcon,
  Star as StarIcon,
  StickyNote as StickyNoteIcon,
  Terminal as TerminalIcon,
  Trash2 as Trash2Icon,
  Undo2 as Undo2Icon,
  UnfoldVertical as UnfoldVerticalIcon,
  Ungroup as UngroupIcon,
  WandSparkles as WandSparklesIcon,
  WholeWord as WholeWordIcon,
  Workflow as WorkflowIcon,
  Wrench as WrenchIcon,
  X as XIcon,
  Zap as ZapIcon,
  ArrowUpRight as ArrowUpRightIcon,
  Ban as BanIcon,
  ChartLine as ChartLineIcon,
  CircleCheck as CircleCheckIcon,
  Ellipsis as EllipsisIcon,
  FileText as FileTextIcon,
  Info as InfoIcon,
  Loader2 as Loader2Icon,
  MessageCircleQuestion as MessageCircleQuestionIcon,
  Repeat2 as Repeat2Icon,
  SquareKanban as SquareKanbanIcon,
  SquareMenu as SquareMenuIcon,
  Table as TableIcon,
  TriangleAlert as TriangleAlertIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import {
  createContext,
  forwardRef,
  useContext,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

let defaultIconArtwork: Readonly<Record<string, ReactNode>> = {};

/** Configure before mounting UI, including independently mounted toast roots. */
export function configureDefaultIconArtwork(artwork: Readonly<Record<string, ReactNode>>) {
  defaultIconArtwork = artwork;
}

/** Optional, theme-aware artwork on a 24px grid; unspecified icons use the default glyph. */
export const IconArtworkContext = createContext<
  Readonly<Record<string, ReactNode>> | null
>(null);

/** Props shared by every chrome icon. */
export type IconProps = LucideProps;

export type IconComponent = ReturnType<typeof wrap>;

function wrap(Glyph: LucideIcon, name: string) {
  const Component = forwardRef(function Icon(
    { strokeWidth = 2, style, ...props }: IconProps,
    ref: Ref<SVGSVGElement>,
  ) {
    const artwork = (useContext(IconArtworkContext) ?? defaultIconArtwork)[name];
    if (artwork) {
      const {
        size = 24,
        color = "currentColor",
        absoluteStrokeWidth: _absoluteStrokeWidth,
        children,
        ...svgProps
      } = props;
      return (
        <svg
          ref={ref}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="none"
          color={color}
          aria-hidden={
            props["aria-label"] || props["aria-labelledby"] || props.role
              ? undefined
              : true
          }
          focusable="false"
          {...svgProps}
          data-ui-icon={name}
          data-ui-icon-artwork=""
          style={style}
        >
          {artwork}
          {children}
        </svg>
      );
    }
    return (
      <Glyph
        ref={ref}
        strokeWidth={strokeWidth}
        {...props}
        data-ui-icon={name}
        style={
          {
            "--ui-icon-stroke-width": props.absoluteStrokeWidth
              ? (Number(strokeWidth) * 24) / Number(props.size ?? 24)
              : strokeWidth,
            ...style,
          } as CSSProperties
        }
      />
    );
  });
  Component.displayName = name;
  return Component;
}

export const AudioLines = wrap(AudioLinesIcon, "AudioLines");
export const Bell = wrap(BellIcon, "Bell");
export const MoreVertical = wrap(MoreVerticalIcon, "MoreVertical");
export const SquarePen = wrap(SquarePenIcon, "SquarePen");
export const SunMoon = wrap(SunMoonIcon, "SunMoon");
export const UserRound = wrap(UserRoundIcon, "UserRound");
export const Vibrate = wrap(VibrateIcon, "Vibrate");
export const Volume2 = wrap(Volume2Icon, "Volume2");
export const AlertCircle = wrap(AlertCircleIcon, "AlertCircle");
export const AppWindow = wrap(AppWindowIcon, "AppWindow");
export const Archive = wrap(ArchiveIcon, "Archive");
export const FileImport = wrap(FileInputIcon, "FileImport");
export const ArrowDownCircle = wrap(ArrowDownCircleIcon, "ArrowDownCircle");
export const ArrowLeft = wrap(ArrowLeftIcon, "ArrowLeft");
export const ArrowRight = wrap(ArrowRightIcon, "ArrowRight");
export const MoveLeft = wrap(MoveLeftIcon, "MoveLeft");
export const MoveRight = wrap(MoveRightIcon, "MoveRight");
export const MousePointer2 = wrap(MousePointer2Icon, "MousePointer2");
export const ArrowUp = wrap(ArrowUpIcon, "ArrowUp");
export const Bot = wrap(BotIcon, "Bot");
export const AiIdea = wrap(LightbulbIcon, "AiIdea");
export const CaseSensitive = wrap(CaseSensitiveIcon, "CaseSensitive");
export const Chatting = wrap(MessagesSquareIcon, "Chatting");
export const CodeXml = wrap(CodeXmlIcon, "CodeXml");
export const Check = wrap(CheckIcon, "Check");
export const CheckCheck = wrap(CheckCheckIcon, "CheckCheck");
export const CheckCircle = wrap(CheckCircleIcon, "CheckCircle");
export const ChevronDown = wrap(ChevronDownIcon, "ChevronDown");
export const ChevronLeft = wrap(ChevronLeftIcon, "ChevronLeft");
export const ChevronRight = wrap(ChevronRightIcon, "ChevronRight");
export const CornerDownRight = wrap(CornerDownRightIcon, "CornerDownRight");
export const CornerDownLeft = wrap(CornerDownLeftIcon, "CornerDownLeft");
export const ChevronUp = wrap(ChevronUpIcon, "ChevronUp");
export const ChevronsUpDown = wrap(ChevronsUpDownIcon, "ChevronsUpDown");
export const CircleAlert = wrap(CircleAlertIcon, "CircleAlert");
export const CircleDashed = wrap(CircleDashedIcon, "CircleDashed");
export const CircleDot = wrap(CircleDotIcon, "CircleDot");
export const CircleHelp = wrap(CircleHelpIcon, "CircleHelp");
export const CircleStop = wrap(CircleStopIcon, "CircleStop");
export const CircleX = wrap(CircleXIcon, "CircleX");
export const CloudUpload = wrap(CloudUploadIcon, "CloudUpload");
export const Clock = wrap(ClockIcon, "Clock");
export const CalendarDays = wrap(CalendarDaysIcon, "CalendarDays");
export const Copy = wrap(CopyIcon, "Copy");
export const Computer = wrap(MonitorIcon, "Computer");
export const CursorMagicSelection = wrap(
  SquareDashedMousePointerIcon,
  "CursorMagicSelection",
);
export const ExternalLink = wrap(ExternalLinkIcon, "ExternalLink");
export const Link = wrap(LinkIcon, "Link");
export const Laptop = wrap(LaptopIcon, "Laptop");
export const Code = wrap(CodeIcon, "Code");
export const File = wrap(FileIcon, "File");
export const FileDiff = wrap(FileDiffIcon, "FileDiff");
export const FilePlus = wrap(FilePlusIcon, "FilePlus");
export const FilePlusCorner = wrap(FilePlusCornerIcon, "FilePlusCorner");
export const FileScript = wrap(FileCodeIcon, "FileScript");
export const FoldVertical = wrap(FoldVerticalIcon, "FoldVertical");
export const Folder = wrap(FolderIcon, "Folder");
export const Home = wrap(HomeIcon, "Home");
export const FolderOpen = wrap(FolderOpenIcon, "FolderOpen");
export const Eye = wrap(EyeIcon, "Eye");
export const FolderPlus = wrap(FolderPlusIcon, "FolderPlus");
export const FolderTree = wrap(FolderTreeIcon, "FolderTree");
export const Gauge = wrap(GaugeIcon, "Gauge");
export const ChartBreakoutSquare = wrap(
  ChartNoAxesCombinedIcon,
  "ChartBreakoutSquare",
);
export const GitBranch = wrap(GitBranchIcon, "GitBranch");
export const Split = wrap(SplitIcon, "Split");
export const GitCompare = wrap(GitCompareIcon, "GitCompare");
export const GitMerge = wrap(GitMergeIcon, "GitMerge");
export const GitPullRequest = wrap(GitPullRequestIcon, "GitPullRequest");
export const GitPullRequestClosed = wrap(
  GitPullRequestClosedIcon,
  "GitPullRequestClosed",
);
export const GitPullRequestDraft = wrap(
  GitPullRequestDraftIcon,
  "GitPullRequestDraft",
);
export const GripVertical = wrap(GripVerticalIcon, "GripVertical");
export const Globe = wrap(GlobeIcon, "Globe");
export const Internet = wrap(EarthIcon, "Internet");
export const ImagePlus = wrap(ImagePlusIcon, "ImagePlus");
export const Inbox = wrap(InboxIcon, "Inbox");
export const BellOff = wrap(BellOffIcon, "BellOff");
export const Keyboard = wrap(KeyboardIcon, "Keyboard");
export const PairingCode = wrap(RectangleEllipsisIcon, "PairingCode");
export const ScanQrCode = wrap(ScanQrCodeIcon, "ScanQrCode");
export const CameraOff = wrap(CameraOffIcon, "CameraOff");
export const ListBullet = wrap(ListIcon, "ListBullet");
export const ListEnd = wrap(ListEndIcon, "ListEnd");
export const ListFilter = wrap(ListFilterIcon, "ListFilter");
export const Loader = wrap(LoaderCircleIcon, "Loader");
export const LoaderCircle = wrap(LoaderCircleIcon, "LoaderCircle");
export const Lock = wrap(LockIcon, "Lock");
export const Maximize2 = wrap(Maximize2Icon, "Maximize2");
export const MessageMultiple = wrap(MessagesSquareIcon, "MessageMultiple");
export const MessageSquare = wrap(MessageSquareIcon, "MessageSquare");
export const MessageSquarePlus = wrap(
  MessageSquarePlusIcon,
  "MessageSquarePlus",
);
export const Minus = wrap(MinusIcon, "Minus");
export const MoreHorizontal = wrap(MoreHorizontalIcon, "MoreHorizontal");
export const Palette = wrap(PaletteIcon, "Palette");
export const Pause = wrap(PauseIcon, "Pause");
export const PanelBottom = wrap(PanelBottomIcon, "PanelBottom");
export const PanelLeft = wrap(PanelLeftIcon, "PanelLeft");
export const PanelRight = wrap(PanelRightIcon, "PanelRight");
export const PanelTop = wrap(PanelTopIcon, "PanelTop");
export const PenLine = wrap(PenLineIcon, "PenLine");
export const Pencil = wrap(PencilIcon, "Pencil");
export const Pin = wrap(PinIcon, "Pin");
export const PinOff = wrap(PinOffIcon, "PinOff");
export const Play = wrap(PlayIcon, "Play");
export const Pipette = wrap(PipetteIcon, "Pipette");
export const Plus = wrap(PlusIcon, "Plus");
export const RefreshCw = wrap(RefreshCwIcon, "RefreshCw");
export const WrapText = wrap(WrapTextIcon, "WrapText");
export const Regex = wrap(RegexIcon, "Regex");
export const Replace = wrap(ReplaceIcon, "Replace");
export const RotateCcw = wrap(RotateCcwIcon, "RotateCcw");
export const Search = wrap(SearchIcon, "Search");
export const Settings = wrap(SettingsIcon, "Settings");
export const Share = wrap(ShareIcon, "Share");
export const Shield = wrap(ShieldIcon, "Shield");
export const SlidersHorizontal = wrap(
  SlidersHorizontalIcon,
  "SlidersHorizontal",
);
export const Smartphone = wrap(SmartphoneIcon, "Smartphone");
export const Sparkles = wrap(SparklesIcon, "Sparkles");
export const Square = wrap(SquareIcon, "Square");
export const SquarePlus = wrap(SquarePlusIcon, "SquarePlus");
export const Star = wrap(StarIcon, "Star");
export const StickyNote = wrap(StickyNoteIcon, "StickyNote");
export const Terminal = wrap(TerminalIcon, "Terminal");
export const Trash2 = wrap(Trash2Icon, "Trash2");
export const Undo2 = wrap(Undo2Icon, "Undo2");
export const UnfoldVertical = wrap(UnfoldVerticalIcon, "UnfoldVertical");
export const Ungroup = wrap(UngroupIcon, "Ungroup");
export const WandSparkles = wrap(WandSparklesIcon, "WandSparkles");
export const WholeWord = wrap(WholeWordIcon, "WholeWord");
export const Workflow = wrap(WorkflowIcon, "Workflow");
export const Wrench = wrap(WrenchIcon, "Wrench");
export const X = wrap(XIcon, "X");
export const Zap = wrap(ZapIcon, "Zap");

/** Glyphs the workflow views ported from ZCode use. */
export const ArrowUpRight = wrap(ArrowUpRightIcon, "ArrowUpRight");
export const Ban = wrap(BanIcon, "Ban");
export const ChartLine = wrap(ChartLineIcon, "ChartLine");
export const CircleCheck = wrap(CircleCheckIcon, "CircleCheck");
export const Ellipsis = wrap(EllipsisIcon, "Ellipsis");
export const FileText = wrap(FileTextIcon, "FileText");
export const Info = wrap(InfoIcon, "Info");
export const List = wrap(ListIcon, "List");
export const ListChecks = wrap(ListChecksIcon, "ListChecks");
export const Download = wrap(DownloadIcon, "Download");
export const Loader2 = wrap(Loader2Icon, "Loader2");
export const MessageCircleQuestion = wrap(
  MessageCircleQuestionIcon,
  "MessageCircleQuestion",
);
export const Repeat2 = wrap(Repeat2Icon, "Repeat2");
export const SquareKanban = wrap(SquareKanbanIcon, "SquareKanban");
export const SquareMenu = wrap(SquareMenuIcon, "SquareMenu");
export const Table = wrap(TableIcon, "Table");
export const TriangleAlert = wrap(TriangleAlertIcon, "TriangleAlert");
