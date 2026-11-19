'use client';

import {
  AlertDialog,
  GrainDial,
  InspectorGroup,
  InspectorRow,
  InspectorRows,
  Measure,
  DOMAIN_ICONS,
  Logo,
  LogoMark,
  Wordmark,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  FormField,
  IconButton,
  Input,
  Kbd,
  Label,
  NumberInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeSwitcher,
  Toaster,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  EmptyState,
  ErrorState,
  notify,
  Tooltip,
  TooltipProvider,
  toast,
  type NumberParseError,
} from '@nittcam/ui';
import { Copy, FolderPlus, MoreHorizontal, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { grainDialLabels } from '../../lib/grain-labels';
import type { Messages } from '../../lib/messages';

type T = Messages['devUi'];

const VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'destructive'] as const;
const SIZES = ['sm', 'md', 'lg'] as const;
const BADGES = ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'solid'] as const;

const SWATCHES = {
  surfaces: ['bg', 'surface', 'surface-subtle', 'surface-raised', 'surface-hover', 'border'],
  text: ['fg', 'fg-muted', 'fg-subtle', 'fg-disabled'],
  accent: ['accent', 'accent-hover', 'accent-subtle', 'focus'],
  status: ['success', 'warning', 'danger', 'info'],
} as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} data-section={id} className="flex flex-col gap-4">
      <h2 id={`${id}-h`} className="text-lg font-semibold tracking-tight text-fg">
        {title}
      </h2>
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs sm:p-6">
        {children}
      </div>
    </section>
  );
}

function Row({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex flex-col gap-2">
      {label ? <span className="text-xs font-medium text-fg-subtle">{label}</span> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const numberErrors = (t: T): Record<NumberParseError, string> => ({
  empty: t.number.errorEmpty,
  invalid: t.number.errorInvalid,
  min: t.number.errorMin,
  max: t.number.errorMax,
});

export function UiGallery({ t }: { t: T }) {
  const [width, setWidth] = useState<number | null>(1220.5);
  const [widthError, setWidthError] = useState<NumberParseError | null>(null);
  const [thickness, setThickness] = useState<number | null>(18);
  const [grain, setGrain] = useState(true);
  const [grainAngle, setGrainAngle] = useState(30);
  const [grainLive, setGrainLive] = useState(30);
  const grainLabels = grainDialLabels();
  const errors = numberErrors(t);

  return (
    <TooltipProvider>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 sm:px-8 sm:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-3xl font-semibold text-fg">{t.title}</h1>
            <p className="text-sm text-fg-muted">{t.subtitle}</p>
          </div>
          <ThemeSwitcher labels={t.theme} />
        </header>

        <Section id="brand" title={t.sections.brand}>
          <div className="flex flex-col gap-6" data-testid="gallery-brand">
            <Row label={t.brand.wordmark}>
              <Wordmark size={20} />
              <Wordmark size={24} />
              <Wordmark size={32} />
              <Wordmark size={24} variant="short" />
              <span className="rounded-lg bg-accent p-3 text-accent-fg">
                <Wordmark size={24} tone="mono" />
              </span>
            </Row>
            <Row label={t.brand.full}>
              <Logo size={32} />
            </Row>
            <Row label={t.brand.sizes}>
              <Logo size={20} />
              <Logo size={24} />
              <Logo size={32} />
              <Logo size={24} variant="mark" />
            </Row>
            <Row label={t.brand.variants}>
              <LogoMark size={32} />
              <LogoMark size={32} variant="plain" className="text-fg" />
              <LogoMark size={32} variant="mono" className="text-fg" />
              <LogoMark size={16} />
            </Row>
            <Row label={t.brand.backgrounds}>
              <span className="rounded-lg border border-border bg-bg p-4">
                <Logo size={24} />
              </span>
              <span className="rounded-lg border border-border bg-surface-subtle p-4">
                <Logo size={24} />
              </span>
              <span className="rounded-lg bg-accent p-4 text-accent-fg">
                <Logo size={24} tone="mono" />
              </span>
            </Row>
            <Row label={t.brand.icons}>
              {[16, 20, 24].map((size) => (
                <span
                  key={size}
                  className="flex items-center gap-3 text-fg"
                  data-testid="gallery-icons"
                >
                  {Object.entries(DOMAIN_ICONS).map(([name, Icon]) => (
                    <Icon key={name} size={size} aria-label={name} />
                  ))}
                </span>
              ))}
            </Row>
            <Row label={t.brand.clearSpace}>
              <span className="rounded-md p-3 outline-1 outline-border-strong outline-dashed">
                <Logo size={32} />
              </span>
            </Row>
          </div>
        </Section>

        <Section id="colors" title={t.sections.colors}>
          <div className="grid gap-6 sm:grid-cols-2">
            {(Object.keys(SWATCHES) as Array<keyof typeof SWATCHES>).map((group) => (
              <div key={group} className="flex flex-col gap-2">
                <span className="text-xs font-medium text-fg-subtle">{t.colorGroups[group]}</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SWATCHES[group].map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <span
                        className="size-8 shrink-0 rounded-md border border-border"
                        style={{ background: `var(--color-${name})` }}
                      />
                      <code className="truncate text-xs text-fg-muted">{name}</code>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="type" title={t.sections.type}>
          <div className="flex flex-col gap-3">
            <p className="text-4xl font-semibold text-fg">{t.title}</p>
            <p className="text-2xl font-semibold text-fg">{t.typeSample}</p>
            <p className="text-base text-fg">{t.typeBody}</p>
            <p className="text-sm text-fg-muted">{t.typeBody}</p>
            <p className="text-xs text-fg-subtle">{t.typeBody}</p>
            <p className="numeric text-sm text-fg">1.220,0 · 2.440,0 · 18,0 · 111,1 mm</p>
            <p className="font-mono text-sm text-fg" data-testid="gallery-mono">
              G1 X1220.000 Y2440.000 F12000 · mutfak-dolabi_İŞĞıüç.nc · sha256 9f2c…
            </p>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm text-fg">
              <Measure value={[3050, 2150]} unit="mm" />
              <Measure value={18} decimals={1} unit="mm" />
              <Measure value={12000} unit="mm/dk" maxDecimals={0} />
              <Measure value={[412.5, -18]} unit="mm" mono />
              <span className="numeric text-3xl font-semibold tracking-tight">
                <Measure value={43.6} unit="%" />
              </span>
            </div>
          </div>
        </Section>

        <Section id="density" title={t.sections.density}>
          <div className="grid gap-6 md:grid-cols-2">
            {(['comfortable', 'compact'] as const).map((d) => (
              <div
                key={d}
                data-density={d === 'compact' ? 'compact' : undefined}
                data-testid={`density-${d}`}
                className="flex flex-col gap-3 rounded-lg border border-border-subtle p-panel"
              >
                <span className="text-xs font-medium text-fg-subtle">{t.density[d]}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="md">{t.variants.primary}</Button>
                  <Button size="md" variant="outline">
                    {t.variants.outline}
                  </Button>
                  <Input aria-label={t.density[d]} defaultValue="1.220" className="w-28" />
                </div>
                <div className="divide-y divide-border-subtle rounded-md border border-border-subtle text-sm">
                  {t.density.rows.map((name, i) => (
                    <div key={name} className="flex h-row items-center gap-3 px-3">
                      <span className="flex-1 truncate text-fg">{name}</span>
                      <Measure
                        value={[720 - i * 38, 560 - i * 20]}
                        unit="mm"
                        className="text-fg-muted"
                      />
                    </div>
                  ))}
                </div>
                {/* T249 (D-040): the inspector row of every canvas screen; T130: its group. */}
                <InspectorGroup title={t.density.rows[0]} className="max-w-[264px]">
                  <InspectorRows data-testid={`inspector-rows-${d}`}>
                    {t.density.rows.slice(0, 3).map((name, i) => (
                      <InspectorRow key={name} label={name}>
                        <Measure value={[596 - i * 36, 716 - i * 20]} unit="mm" mono />
                      </InspectorRow>
                    ))}
                  </InspectorRows>
                </InspectorGroup>
              </div>
            ))}
          </div>
        </Section>

        <Section id="buttons" title={t.sections.buttons}>
          <div className="flex flex-col gap-5">
            {SIZES.map((size) => (
              <Row key={size} label={t.sizes[size]}>
                {VARIANTS.map((v) => (
                  <Button key={v} variant={v} size={size}>
                    {v === 'primary' ? <Plus aria-hidden /> : null}
                    {t.variants[v]}
                  </Button>
                ))}
              </Row>
            ))}
            <Row label={`${t.states.disabled} · ${t.states.loading}`}>
              {VARIANTS.map((v) => (
                <Button key={v} variant={v} disabled>
                  {t.variants[v]}
                </Button>
              ))}
              <Button loading>{t.states.loading}</Button>
              <Button variant="outline" loading>
                {t.states.loading}
              </Button>
            </Row>
            <Row label="IconButton">
              <IconButton aria-label={t.iconLabels.add} variant="primary">
                <Plus aria-hidden />
              </IconButton>
              <IconButton aria-label={t.iconLabels.settings} variant="outline">
                <Settings aria-hidden />
              </IconButton>
              <Tooltip content={t.iconLabels.more}>
                <IconButton aria-label={t.iconLabels.more}>
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </Tooltip>
              <IconButton aria-label={t.iconLabels.delete} variant="destructive" size="sm">
                <Trash2 aria-hidden />
              </IconButton>
              <IconButton aria-label={t.iconLabels.settings} size="lg" variant="secondary">
                <Settings aria-hidden />
              </IconButton>
            </Row>
          </div>
        </Section>

        <Section id="forms" title={t.sections.forms}>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label={t.form.name} hint={t.form.nameHint}>
              <Input placeholder={t.form.namePlaceholder} />
            </FormField>
            <FormField label={t.form.material}>
              <Select defaultValue="mdf">
                <SelectTrigger>
                  <SelectValue placeholder={t.form.materialPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t.form.materialGroup}</SelectLabel>
                    {(['mdf', 'plywood', 'melamine', 'acrylic'] as const).map((k) => (
                      <SelectItem key={k} value={k}>
                        {t.form.materials[k]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t.form.invalid} error={t.form.invalidError}>
              <Input defaultValue="" placeholder={t.form.namePlaceholder} />
            </FormField>
            <FormField label={t.form.disabled}>
              <Input disabled defaultValue={t.form.disabledValue} />
            </FormField>
            <FormField
              label={t.form.notes}
              optionalLabel={t.form.optional}
              className="sm:col-span-2"
            >
              <Textarea placeholder={t.form.notesPlaceholder} />
            </FormField>
          </div>
        </Section>

        <Section id="numbers" title={t.sections.numbers}>
          <div className="grid gap-5 sm:grid-cols-3">
            <FormField
              label={t.number.width}
              hint={t.number.widthHint}
              {...(widthError ? { error: errors[widthError] } : {})}
            >
              <NumberInput
                value={width}
                onValueChange={setWidth}
                onValidityChange={setWidthError}
                min={1}
                max={2440}
                unit="mm"
                incrementLabel={t.number.increment}
                decrementLabel={t.number.decrement}
                required
              />
            </FormField>
            <FormField label={t.number.thickness}>
              <NumberInput
                value={thickness}
                onValueChange={setThickness}
                min={1}
                max={60}
                step={0.5}
                unit="mm"
              />
            </FormField>
            <FormField label={t.number.invalidDemo} error={t.number.errorInvalid}>
              <NumberInput value={null} onValueChange={() => {}} unit="mm" invalid />
            </FormField>
            <FormField label={t.number.disabled}>
              <NumberInput value={18} onValueChange={() => {}} unit="mm" disabled />
            </FormField>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-fg">{t.number.value}</span>
              <output className="numeric text-sm text-fg-muted" data-testid="width-value">
                {width === null ? '—' : String(width)}
              </output>
            </div>
          </div>
        </Section>

        <Section id="grain-dial" title={t.sections.grainDial}>
          <div className="grid gap-6 sm:grid-cols-2" data-testid="gallery-grain-dial">
            <Row label={t.grainDemo.md}>
              <GrainDial
                value={grainAngle}
                onValueChange={setGrainLive}
                onValueCommit={(a) => {
                  setGrainAngle(a);
                  setGrainLive(a);
                }}
                labels={grainLabels}
                data-testid="grain-dial-demo"
              />
            </Row>
            <div className="flex flex-col gap-6">
              <Row label={t.grainDemo.sm}>
                <GrainDial
                  value={grainAngle}
                  onValueCommit={setGrainAngle}
                  labels={grainLabels}
                  size="sm"
                  controls={false}
                  data-testid="grain-dial-sm"
                />
                <output className="numeric text-sm text-fg-muted" data-testid="grain-dial-value">
                  {t.grainDemo.value}: {grainLive}°
                </output>
              </Row>
              <Row label={t.grainDemo.none}>
                <GrainDial
                  value={null}
                  onValueCommit={() => {}}
                  labels={grainLabels}
                  size="sm"
                  controls={false}
                />
              </Row>
              <Row label={t.grainDemo.disabled}>
                <GrainDial
                  value={90}
                  onValueCommit={() => {}}
                  labels={grainLabels}
                  size="sm"
                  controls={false}
                  disabled
                />
              </Row>
            </div>
          </div>
        </Section>

        <Section id="toggles" title={t.sections.toggles}>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="g-grain"
                  checked={grain}
                  onCheckedChange={(v) => setGrain(v === true)}
                  aria-describedby="g-grain-hint"
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="g-grain">{t.toggles.grain}</Label>
                  <p id="g-grain-hint" className="text-xs text-fg-muted">
                    {t.toggles.grainHint}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox id="g-edge" checked="indeterminate" />
                <Label htmlFor="g-edge">{t.toggles.edge}</Label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox id="g-dis" disabled />
                <Label htmlFor="g-dis">{t.toggles.disabled}</Label>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Switch id="g-sim" defaultChecked />
                <Label htmlFor="g-sim">{t.toggles.sim}</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="g-sim2" />
                <Label htmlFor="g-sim2">{t.toggles.sim}</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="g-sim3" disabled />
                <Label htmlFor="g-sim3">{t.toggles.disabled}</Label>
              </div>
            </div>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-sm font-medium text-fg">{t.toggles.mode}</legend>
              <RadioGroup defaultValue="balanced">
                {(['fast', 'balanced', 'tight'] as const).map((m) => (
                  <div key={m} className="flex items-center gap-3">
                    <RadioGroupItem value={m} id={`g-mode-${m}`} />
                    <Label htmlFor={`g-mode-${m}`}>{t.toggles.modes[m]}</Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
        </Section>

        <Section id="overlays" title={t.sections.overlays}>
          <Row>
            <Tooltip content={t.overlays.tooltip}>
              <Button variant="outline">{t.overlays.tooltipTrigger}</Button>
            </Tooltip>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">{t.overlays.popoverTrigger}</Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-fg">{t.overlays.popoverTitle}</p>
                    <p className="text-sm text-fg-muted">{t.overlays.popoverBody}</p>
                  </div>
                  <NumberInput
                    value={10}
                    onValueChange={() => {}}
                    unit="mm"
                    aria-label={t.overlays.popoverTitle}
                  />
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  {t.overlays.menuTrigger}
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{t.overlays.menuLabel}</DropdownMenuLabel>
                <DropdownMenuItem>
                  <Copy aria-hidden />
                  {t.overlays.menuDuplicate}
                  <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Pencil aria-hidden />
                  {t.overlays.menuRename}
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem checked>
                  {t.overlays.menuShowWaste}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive>
                  <Trash2 aria-hidden />
                  {t.overlays.menuDelete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">{t.overlays.dialogTrigger}</Button>
              </DialogTrigger>
              <DialogContent closeLabel={t.overlays.close}>
                <DialogHeader>
                  <DialogTitle>{t.overlays.dialogTitle}</DialogTitle>
                  <DialogDescription>{t.overlays.dialogDescription}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t.form.name}>
                    <Input placeholder={t.form.namePlaceholder} />
                  </FormField>
                  <FormField label={t.number.width}>
                    <NumberInput value={2440} onValueChange={() => {}} unit="mm" />
                  </FormField>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{t.overlays.cancel}</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button>{t.overlays.save}</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">{t.overlays.alertTrigger}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.overlays.alertTitle}</AlertDialogTitle>
                  <AlertDialogDescription>{t.overlays.alertDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.overlays.cancel}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive">
                    {t.overlays.alertConfirm}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">{t.overlays.sheetTrigger}</Button>
              </SheetTrigger>
              <SheetContent closeLabel={t.overlays.close}>
                <SheetHeader>
                  <SheetTitle>{t.overlays.sheetTitle}</SheetTitle>
                  <SheetDescription>{t.overlays.sheetDescription}</SheetDescription>
                </SheetHeader>
                <SheetBody className="flex flex-col gap-4">
                  <FormField label={t.number.width}>
                    <NumberInput value={600} onValueChange={() => {}} unit="mm" />
                  </FormField>
                  <FormField label={t.number.thickness}>
                    <NumberInput value={18} onValueChange={() => {}} unit="mm" />
                  </FormField>
                </SheetBody>
                <SheetFooter>
                  <Button>{t.overlays.save}</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <Button
              variant="secondary"
              onClick={() =>
                toast.success(t.overlays.toastTitle, { description: t.overlays.toastBody })
              }
            >
              {t.overlays.toastTrigger}
            </Button>
          </Row>
        </Section>

        <Section id="tabs" title={t.sections.tabs}>
          <div className="flex flex-col gap-8">
            {(['segmented', 'line'] as const).map((variant) => (
              <Tabs key={variant} defaultValue="cutList">
                <TabsList variant={variant}>
                  <TabsTrigger value="cutList">{t.tabs.cutList}</TabsTrigger>
                  <TabsTrigger value="layout">{t.tabs.layout}</TabsTrigger>
                  <TabsTrigger value="simulation" disabled={variant === 'line'}>
                    {t.tabs.simulation}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="cutList" className="text-sm text-fg-muted">
                  {t.tabs.cutListBody}
                </TabsContent>
                <TabsContent value="layout" className="text-sm text-fg-muted">
                  {t.tabs.layoutBody}
                </TabsContent>
                <TabsContent value="simulation" className="text-sm text-fg-muted">
                  {t.tabs.simulationBody}
                </TabsContent>
              </Tabs>
            ))}
          </div>
        </Section>

        <Section id="badges" title={t.sections.badges}>
          <div className="flex flex-col gap-4">
            <Row>
              {BADGES.map((b) => (
                <Badge key={b} variant={b}>
                  {t.badges[b]}
                </Badge>
              ))}
            </Row>
            <Row>
              {BADGES.map((b) => (
                <Badge key={b} variant={b} dot>
                  {t.badges[b]}
                </Badge>
              ))}
            </Row>
          </div>
        </Section>

        <Section id="cards" title={t.sections.cards}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{t.cards.title}</CardTitle>
                  <Badge variant="success" dot>
                    {t.badges.success}
                  </Badge>
                </div>
                <CardDescription className="numeric">{t.cards.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-fg-muted">{t.cards.body}</CardContent>
              <CardFooter className="justify-end">
                <Button variant="outline" size="sm">
                  {t.cards.open}
                </Button>
              </CardFooter>
            </Card>
            <Card interactive>
              <CardHeader>
                <CardTitle>{t.cards.interactive}</CardTitle>
                <CardDescription>{t.cards.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="feedback" title={t.sections.feedback}>
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3" role="status">
              <Spinner />
              <span className="text-sm text-fg-muted">{t.feedback.loading}</span>
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-48 max-w-full" />
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <span>{t.feedback.shortcut}</span>
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
              <span className="mx-2 text-fg-subtle">·</span>
              <Kbd>?</Kbd>
            </div>
          </div>
        </Section>

        <Section id="states" title={t.sections.states}>
          <div className="grid gap-4 md:grid-cols-2">
            <EmptyState
              icon={<FolderPlus />}
              title={t.feedbackStates.emptyTitle}
              description={t.feedbackStates.emptyText}
              action={
                <Button size="sm">
                  <Plus aria-hidden />
                  {t.feedbackStates.emptyAction}
                </Button>
              }
            />
            <ErrorState
              title={t.feedbackStates.errorTitle}
              description={t.feedbackStates.errorText}
              retryLabel={t.feedbackStates.retry}
              onRetry={() => undefined}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                notify.success(t.feedbackStates.successTitle, {
                  action: { label: t.feedbackStates.undo, onClick: () => undefined },
                })
              }
            >
              {t.feedbackStates.notifySuccess}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                notify.error(t.feedbackStates.errorToastTitle, {
                  description: t.feedbackStates.errorText,
                  action: { label: t.feedbackStates.retry, onClick: () => undefined },
                })
              }
            >
              {t.feedbackStates.notifyError}
            </Button>
            <Button variant="secondary" onClick={() => notify.info(t.feedbackStates.infoTitle)}>
              {t.feedbackStates.notifyInfo}
            </Button>
          </div>
        </Section>

        <Section id="command" title={t.sections.command}>
          <Command
            label={t.command.label}
            className="max-w-md rounded-xl border border-border bg-surface-raised shadow-md"
          >
            <CommandInput
              placeholder={t.command.placeholder}
              aria-label={t.command.placeholder}
              className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            />
            <CommandList>
              <CommandEmpty>{t.command.empty}</CommandEmpty>
              <CommandGroup heading={t.command.group}>
                {t.command.items.map((item) => (
                  <CommandItem key={item} value={item}>
                    {item}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </Section>
      </main>
      <Toaster />
    </TooltipProvider>
  );
}
