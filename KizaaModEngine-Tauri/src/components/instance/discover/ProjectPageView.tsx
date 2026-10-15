import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  Bug,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  Download,
  ExternalLink,
  Globe,
  Heart,
  Loader2,
  MessageCircle,
  Package,
  Scale,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { formatDate } from "../../../lib/datetime";
import { useProjectPage, type ProjectPage } from "../../../lib/queries";
import { providerLabel } from "../../common/ProviderBadge";
import { ProjectGallery, type GalleryImage } from "./ProjectGallery";
import type { ContentDetail } from "./ContentDetailPanel";

/** A project as its page needs it; no catalogue for a mod that came from a file. */
export type PageDetail = Omit<ContentDetail, "provider"> & { provider: ContentDetail["provider"] | null };

/** A tab after the overview: the releases, or the files an instance holds. */
export interface PageTab {
  id: string;
  label: string;
  body: ReactNode;
}

const LINK_ICONS: Record<string, typeof Globe> = {
  website: Globe,
  source: Code2,
  issues: Bug,
  wiki: BookOpen,
  discord: MessageCircle,
  donate: Heart,
};

const LINK_LABELS: Record<string, string> = {
  website: "Website",
  source: "Source code",
  issues: "Report a problem",
  wiki: "Wiki",
  discord: "Discord",
  donate: "Support the author",
};

/**
 * A project's pictures as its page lists them: Modrinth's lighter copy for
 * the strip, the picture as uploaded for the viewer, the featured one first.
 *
 * The search result has pictures too, but not these: its banner is a copy
 * 350 pixels wide, blurred once stretched across a header, and the rest are
 * often the uploads themselves, megabytes each, decoded for a thumbnail.
 */
export function pageGallery(page: ProjectPage): GalleryImage[] {
  return page.gallery.map((image) => ({ url: image.url, thumbnailUrl: image.thumbnail_url, title: image.title }));
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/**
 * A project opened whole -- a mod, a modpack, a shader, a pack -- rather than
 * glanced at beside the list: its picture across the top with its name, what
 * to do with it at the right of that, then its pictures and its author's own
 * description, and beside them everything known about it, a card per kind.
 *
 * The action in the header and the card at the top of the side are handed
 * in -- installing it from a catalogue, or what an instance already holds of
 * it -- so the page and the panel can never disagree about them.
 */
export function ProjectPageView({
  detail,
  availableSources = [],
  onSelectSource,
  favorite,
  status,
  primaryAction,
  notice,
  sideCard,
  tabs,
}: {
  detail: PageDetail;
  availableSources?: ("modrinth" | "curseforge")[];
  onSelectSource?: (source: "modrinth" | "curseforge") => void;
  /** The heart beside the action; without it the followers are only counted. */
  favorite?: { active: boolean; onToggle: () => void };
  /** Beside the author, in place of whether it suits the instance. */
  status?: ReactNode;
  /** The big button at the right of the header. */
  primaryAction?: ReactNode;
  /** Said above the tabs, when something stands in the way. */
  notice?: ReactNode;
  /** The first card of the side. */
  sideCard?: ReactNode;
  tabs: PageTab[];
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState("overview");
  const provider = detail.provider;
  const page = useProjectPage(provider ?? "modrinth", detail.projectId, provider !== null);
  const data = page.data;

  // The page's own pictures carry titles and the full-size files; the search
  // result's are there at once, while the page is still on its way.
  const gallery: GalleryImage[] = data ? pageGallery(data) : page.isError ? detail.gallery : [];
  const banner = data?.gallery[0]?.url ?? detail.bannerUrl ?? gallery[0]?.url ?? null;
  // An author's description can hold dozens of full-size pictures and GIFs;
  // each waits until it is scrolled near, and is decoded off the main thread.
  const bodyHtml = useMemo(
    () => (data?.body_html ?? "").replace(/<img\b/gi, '<img loading="lazy" decoding="async"'),
    [data?.body_html],
  );

  // Links in the author's description open in the browser, never in the launcher.
  const openLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
  };

  const facts = [
    { icon: Download, label: t("downloads"), value: detail.downloadsLabel },
    { icon: Users, label: t("Followers"), value: data?.followers ? data.followers.toLocaleString() : null },
    { icon: Clock, label: t("Updated"), value: data?.updated ? formatDate(data.updated) : detail.updatedLabel },
    { icon: CalendarDays, label: t("Published"), value: data?.published ? formatDate(data.published) : null },
    { icon: Scale, label: t("Licence"), value: data?.license ?? detail.licenseLabel },
  ].filter((fact) => fact.value);

  const sources = availableSources.length > 0 ? availableSources : provider ? [provider] : [];
  const category = data?.categories[0] ?? null;

  return (
    <div key={`${detail.provider}:${detail.projectId}`} className="relative min-h-full animate-in fade-in-0 duration-300 motion-reduce:animate-none">
      {/* The header: its picture behind its name, darkened where the words sit. */}
      <div className="relative z-10">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden contrast-more:hidden">
          {banner ? (
            <img src={banner} alt="" className="h-full w-full object-cover opacity-80 animate-in fade-in-0 duration-700" />
          ) : detail.iconUrl ? (
            <img src={detail.iconUrl} alt="" className="h-full w-full scale-150 object-cover opacity-35 blur-[72px] saturate-150" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/45 to-background/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/0" />
        </div>

        <div className="relative mx-auto max-w-[76rem] px-8 pb-9 pt-24 lg:px-12">
          <header className="flex flex-wrap items-end gap-x-7 gap-y-5">
            <div className="h-36 w-36 shrink-0 overflow-hidden rounded-[30px] bg-card shadow-[0_22px_50px_-16px_hsl(242_30%_2%/0.95),0_0_0_1px_hsl(0_0%_100%/0.09)]">
              {detail.iconUrl ? (
                <img src={detail.iconUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-primary/10">
                  <Package className="h-12 w-12 text-primary/70" />
                </div>
              )}
            </div>

            <div className="min-w-[18rem] flex-1">
              {(category || sources.length > 0) && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {category && <HeroChip>{category.replace(/-/g, " ")}</HeroChip>}
                  {sources.map((source) => (
                    <HeroChip
                      key={source}
                      active={source === provider}
                      onClick={onSelectSource && sources.length > 1 ? () => onSelectSource(source) : undefined}
                    >
                      {providerLabel(source)}
                    </HeroChip>
                  ))}
                </div>
              )}
              <h1 className="line-clamp-2 text-[2.75rem] font-bold leading-[1.04] tracking-[-0.035em] [text-shadow:0_2px_24px_hsl(242_30%_2%/0.6)]">
                {detail.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem]">
                {detail.author && (
                  <span className="text-foreground/65">
                    {t("By")} <span className="text-foreground/85">{detail.author}</span>
                  </span>
                )}
                {status}
                {detail.compatible !== null && (
                  <span className={cn("inline-flex items-center gap-1.5 font-medium", detail.compatible ? "text-emerald-400" : "text-amber-400")}>
                    {detail.compatible ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                    {detail.compatible ? t("Compatible with this instance") : t("Not built for this instance")}
                  </span>
                )}
              </div>
              {detail.description && (
                <p className="mt-3 line-clamp-2 max-w-[64ch] text-[1.0625rem] leading-relaxed text-foreground/85">{detail.description}</p>
              )}
            </div>

            <div className="flex items-start gap-3">
              <FollowPill favorite={favorite} followers={data?.followers ?? null} />
              {primaryAction}
            </div>
          </header>
        </div>
      </div>

      <div className="relative mx-auto grid max-w-[76rem] gap-8 px-8 pb-14 lg:px-12 [@container(min-width:900px)]:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="min-w-0">
          {notice}
          <div role="tablist" className="flex gap-8 overflow-x-auto border-b border-border/40 [scrollbar-width:none]">
            {[{ id: "overview", label: t("Overview") }, ...tabs].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "relative -mb-px min-h-12 shrink-0 text-[0.9375rem] font-medium transition-colors duration-150",
                  tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.7)] transition-[opacity,transform] duration-200 ease-out",
                    tab === id ? "scale-x-100 opacity-100" : "scale-x-50 opacity-0",
                  )}
                />
              </button>
            ))}
          </div>

          <div className="pt-7">
            {tab === "overview" && (
              <div className="space-y-8">
                <ProjectGallery images={gallery} projectTitle={detail.title} size="large" />
                <section>
                  <h2 className="mb-4 text-xl font-bold tracking-[-0.02em]">{t("Description")}</h2>
                  {page.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("Loading the description…")}
                    </div>
                  ) : bodyHtml.trim() ? (
                    // Cleaned in the launcher before it gets here: no script,
                    // frame, style or handler survives; see project_page.rs.
                    <div className="kiza-prose" onClick={openLink} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                  ) : provider === null ? (
                    <p className="text-sm text-muted-foreground">{t("It was added from a file, so no catalogue has a page for it.")}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{detail.description || t("This project has no description.")}</p>
                  )}
                </section>
              </div>
            )}
            {tabs.find((other) => other.id === tab)?.body}
          </div>
        </main>

        <aside className="space-y-3 self-start [@container(min-width:900px)]:sticky [@container(min-width:900px)]:top-6">
          {sideCard}

          {facts.length > 0 && (
            <SideCard title={t("Information")}>
              <dl className="space-y-2.5">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex items-center gap-3 text-sm">
                    <fact.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <dt className="min-w-0 flex-1 text-muted-foreground first-letter:uppercase">{fact.label}</dt>
                    <dd className="truncate font-semibold tabular-nums">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </SideCard>
          )}

          {data && data.game_versions.length > 0 && (
            <SideCard title={t("Minecraft versions")}>
              <VersionChips versions={data.game_versions} />
            </SideCard>
          )}
          {data && data.loaders.length > 0 && (
            <SideCard title={t("Modloaders")}>
              <div className="flex flex-wrap gap-1.5">
                {data.loaders.map((loader) => (
                  <span key={loader} className="rounded-lg bg-primary/85 px-2.5 py-1 text-xs font-medium capitalize text-primary-foreground shadow-[0_4px_14px_-6px_hsl(var(--primary))]">
                    {loader.replace(/-/g, " ")}
                  </span>
                ))}
              </div>
            </SideCard>
          )}
          {data && data.categories.length > 0 && (
            <SideCard title={t("Categories")}>
              <div className="flex flex-wrap gap-1.5">
                {data.categories.map((item) => (
                  <span key={item} className="rounded-lg bg-secondary/60 px-2.5 py-1 text-xs font-medium capitalize text-foreground/85">
                    {item.replace(/-/g, " ")}
                  </span>
                ))}
              </div>
            </SideCard>
          )}

          {data && data.links.length > 0 && (
            <SideCard title={t("Links")}>
              <div className="flex flex-wrap gap-1.5">
                {data.links.map((link) => {
                  const Icon = LINK_ICONS[link.kind] ?? Globe;
                  return (
                    <button
                      key={`${link.kind}:${link.url}`}
                      type="button"
                      onClick={() => void openUrl(link.url)}
                      title={link.url}
                      className="group inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-secondary/55 px-2.5 text-xs font-medium transition-[background-color,scale] duration-150 hover:bg-secondary/85 active:scale-[0.96]"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                      {t(LINK_LABELS[link.kind] ?? "Website")}
                      <ExternalLink className="h-3 w-3 text-muted-foreground/60" />
                    </button>
                  );
                })}
              </div>
            </SideCard>
          )}
        </aside>
      </div>
    </div>
  );
}

/** One card of the side: a title and what it holds. */
export function SideCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-card/70 p-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.08),0_18px_40px_-28px_hsl(0_0%_0%/0.9)]">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function HeroChip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  const className = cn(
    "rounded-full px-3 py-1 text-xs font-medium capitalize transition-[background-color,color,scale] duration-150",
    active
      ? "bg-primary text-primary-foreground shadow-[0_4px_16px_-6px_hsl(var(--primary))]"
      : "bg-secondary/85 text-foreground/80",
    onClick && !active && "hover:bg-secondary hover:text-foreground active:scale-[0.96]",
  );
  if (!onClick) return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {children}
    </button>
  );
}

/** The heart and how many follow it; only counted where there is nothing to keep. */
function FollowPill({ favorite, followers }: { favorite?: { active: boolean; onToggle: () => void }; followers: number | null }) {
  const { t } = useI18n();
  if (!favorite && !followers) return null;
  const count = followers ? compact.format(followers) : null;
  const body = (
    <>
      <Heart className={cn("h-5 w-5", favorite?.active && "fill-current text-primary")} />
      {count && <span className="tabular-nums">{count}</span>}
    </>
  );
  const className =
    "inline-flex h-12 items-center gap-2 rounded-xl bg-card/85 px-4 text-sm font-semibold shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.1)]";
  if (!favorite) return <span className={className}>{body}</span>;
  return (
    <button
      type="button"
      onClick={favorite.onToggle}
      aria-pressed={favorite.active}
      aria-label={favorite.active ? t("Remove from favorites") : t("Add to favorites")}
      className={cn(className, "transition-[background-color,scale] duration-150 hover:bg-card active:scale-[0.96]")}
    >
      {body}
    </button>
  );
}

/** Every Minecraft version it is made for, a few rows of them, the rest counted. */
function VersionChips({ versions }: { versions: string[] }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const shown = all ? versions : versions.slice(0, 14);
  const hidden = versions.length - shown.length;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1.5">
      {shown.map((version) => (
        <span key={version} className="rounded-lg bg-secondary/60 px-1.5 py-1 text-center text-xs tabular-nums text-foreground/85">
          {version}
        </span>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="col-span-2 rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-[background-color] duration-150 hover:bg-primary/20"
        >
          {t("+{count} more").replace("{count}", String(hidden))}
        </button>
      )}
    </div>
  );
}

/**
 * The header's button: the action itself, and beside it a chevron opening
 * the choices around it -- which release, or what else can be done.
 */
export function SplitAction({
  label,
  icon,
  onClick,
  disabled,
  tone = "primary",
  caption,
  onMenuOpen,
  menu,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** `primary` to do something; `quiet` when it is already done. */
  tone?: "primary" | "quiet";
  /** A line under the button: the release it will install. */
  caption?: ReactNode;
  onMenuOpen?: () => void;
  /** What the chevron opens, given a way to close it; no chevron without it. */
  menu?: (close: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const shell =
    tone === "primary"
      ? "bg-gradient-to-r from-primary to-violet-500 text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.2),0_14px_34px_-12px_hsl(var(--primary)/0.9)]"
      : "bg-card/90 text-foreground shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.12)]";

  return (
    <div ref={root} className="relative">
      <div className={cn("flex h-12 overflow-hidden rounded-xl", shell)}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="inline-flex min-w-[9.5rem] items-center justify-center gap-2.5 px-6 text-[0.9375rem] font-semibold transition-[background-color,opacity] duration-150 hover:bg-white/10 active:bg-white/15 disabled:pointer-events-none disabled:opacity-60"
        >
          {icon}
          {label}
        </button>
        {menu && (
          <button
            type="button"
            aria-label={t("More actions")}
            aria-expanded={open}
            onClick={() => {
              if (!open) onMenuOpen?.();
              setOpen((was) => !was);
            }}
            className="flex w-12 items-center justify-center border-l border-white/15 transition-[background-color] duration-150 hover:bg-white/10 active:bg-white/15"
          >
            <ChevronDown className={cn("h-[18px] w-[18px] transition-transform duration-200", open && "rotate-180")} />
          </button>
        )}
      </div>
      {caption && <div className="mt-2 max-w-[20rem] truncate text-right text-xs text-muted-foreground">{caption}</div>}
      {menu && open && (
        <div className="absolute right-0 top-[3.5rem] z-30 w-80 origin-top-right rounded-2xl bg-popover/95 p-1.5 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.1),0_24px_60px_hsl(242_30%_2%/0.7)] backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150">
          {menu(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One line of a `SplitAction` menu. */
export function MenuItem({
  icon,
  onClick,
  disabled,
  danger,
  selected,
  hint,
  children,
}: {
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  selected?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-[background-color] duration-150 disabled:pointer-events-none disabled:opacity-50",
        danger ? "text-red-300 hover:bg-red-500/10" : "hover:bg-secondary/60",
        selected && "bg-primary/10 text-primary",
      )}
    >
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{children}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}
