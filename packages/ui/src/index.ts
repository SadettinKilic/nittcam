// @nittcam/ui: design tokens (tokens.css), theme and primitives (T100, T101, D-032).
export { cn, cva, type VariantProps } from './lib/cn';
export {
  formatNumberTr,
  parseNumberTr,
  stepNumber,
  type NumberBounds,
  type NumberParseError,
  type NumberParseResult,
} from './lib/number';
export { foldTr, fuzzyScore } from './lib/search';
export { ThemeProvider, useTheme, THEMES, THEME_STORAGE_KEY, type ThemeChoice } from './theme';
export { PageTitle } from './page-title';
export type { PageTitleProps } from './page-title';

export {
  Button,
  IconButton,
  Spinner,
  buttonVariants,
  type ButtonProps,
  type IconButtonProps,
} from './components/button';
export { Input, Textarea, type InputProps } from './components/input';
export { NumberInput, type NumberInputProps } from './components/number-input';
export {
  FormField,
  Label,
  useFieldControlProps,
  type FormFieldProps,
} from './components/form-field';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/select';
export { Checkbox, LiteCheckbox, RadioGroup, RadioGroupItem, Switch } from './components/toggles';
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  type DialogContentProps,
  type SheetContentProps,
} from './components/overlays';
export {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Kbd,
  Progress,
  Skeleton,
  badgeVariants,
  type BadgeProps,
} from './components/display';
export { Separator, Tabs, TabsContent, TabsList, TabsTrigger } from './components/layout';
export {
  ThemeSwitcher,
  Toaster,
  toast,
  type ThemeSwitcherProps,
} from './components/theme-switcher';
export {
  COMMAND_ID_SEPARATOR,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut,
  type CommandDialogProps,
} from './components/command';
export {
  EmptyState,
  ErrorState,
  notify,
  type EmptyStateProps,
  type ErrorStateProps,
  type NotifyOptions,
} from './components/feedback';
export { fieldBase, fieldFocus, focusRing } from './lib/styles';
export {
  BRAND_MARK,
  Logo,
  LogoMark,
  type LogoMarkProps,
  type LogoProps,
  type LogoSize,
  Wordmark,
  type WordmarkProps,
} from './components/logo';
export {
  AirCutIcon,
  DOMAIN_ICONS,
  GrainIcon,
  NestingIcon,
  RouterIcon,
  SheetIcon,
  ToolpathIcon,
  type DomainIcon,
  type DomainIconProps,
} from './components/domain-icons';
export { Measure, formatMeasure, type MeasureProps } from './components/measure';
export {
  InspectorGroup,
  InspectorRow,
  InspectorRows,
  type InspectorGroupProps,
  type InspectorRowProps,
} from './components/inspector-row';
export {
  GrainArrow,
  GrainDial,
  type GrainArrowProps,
  type GrainDialLabels,
  type GrainDialProps,
} from './components/grain-dial';
export {
  GRAIN_SNAP_STEP,
  GRAIN_SNAP_TOLERANCE,
  isSnappedGrainAngle,
  normalizeGrainAngle,
  pointerToGrainAngle,
  snapGrainAngle,
  stepGrainAngle,
} from './lib/angle';
export { Slider, type SliderProps } from './components/slider';
