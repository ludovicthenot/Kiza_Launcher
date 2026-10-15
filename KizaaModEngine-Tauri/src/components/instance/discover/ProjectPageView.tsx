import { useState, type MouseEvent, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  Bug,
  CalendarDays,
  CheckCircle2,
  Clock,
  Code2,
  Download,
  Globe,
  Heart,
  Loader2,
  MessageCircle,
  Scale,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { formatDate } from "../../../lib/datetime";
import { useProjectPage } from "../../../lib/queries";
import { ProviderBadge, providerLabel } from "../../common/ProviderBadge";
import { ProjectGallery, type GalleryImage } from "./ProjectGallery";
import type { ContentDetail } from "./ContentDetailPanel";

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
 * A project opened whole -- a mod, a modpack, a shader, a pack -- rather than
 * glanced at beside the list: its picture across the top, its pictures and
 * its author's own description down the page, and beside them how to install
 * it and everything known about it. The installing is the panel's own,
 * handed in, so the page and the panel can never disagree about it.
 */
export function ProjectPageView({
  detail,
  availableSources,
  onSelectSource,
  favoriteButton,
  installBody,
  versionsBody,
}: {
  detail: ContentDetail;
  availableSources: ("modrinth" | "curseforge")[];
  onSelectSource?: (source: "modrinth" | "curseforge") => void;
  favoriteButton: ReactNode;
  installBody: ReactNode;
  versionsBody: ReactNode;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"description" | "versions">("description");
  const page = useProjectPage(detail.provider, detail.projectId, true);
  const data = page.data;

  // The page's own pictures carry titles and the full-size files; the search
  // result's are there at once, while the page is still on its way.
  const gallery: GalleryImage[] = data?.gallery.length
    ? data.gallery.map((image) => ({ url: image.url, thumbnailUrl: image.thumbnail_url, title: image.title }))
    : detail.gallery;
  const banner = detail.bannerUrl ?? gallery[0]?.url ?? null;

  // Links in the author's description open in the browser, never in the launcher.
  const openLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
  };

  const facts: { icon: typeof Download; label: string; value: string | null }[] = [
    { icon: Download, label: t("downloads"), value: detail.downloadsLabel },
    { icon: Users, label: t("Followers"), value: data?.followers ? data.followers.toLocaleString() : null },
    { icon: Clock, label: t("Updated"), value: data?.updated ? formatDate(data.updated) : detail.updatedLabel },
    { icon: CalendarDays, label: t("Published"), value: data?.published ? formatDate(data.published) : null },
    { icon: Scale, label: t("Licence"), value: data?.license ?? detail.licenseLabel },
  ];

  return (
    <div key={`${detail.provider}:${detail.projectId}`} className="relative min-h-full animate-in fade-in-0 duration-300 motion-reduce:animate-none">
      {/* Its picture across the top, fading into the page. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[22rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_35%,transparent)] contrast-more:hidden">
        {banner ? (
          <img src={banner} alt="" className="h-full w-full object-cover opacity-55 animate-in fade-in-0 duration-700" />
        ) : detail.iconUrl ? (
          <img src={detail.iconUrl} alt="" className="h-full w-full scale-150 object-cover opacity-30 blur-[72px] saturate-150" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-background/0 via-background/35 to-background" />
      </div>

      <div className="relative mx-auto max-w-[72rem] px-8 pb-12 pt-36 lg:px-12">
        <header className="flex items-end gap-6">
          <div className="h-32 w-32 shrink-0 overflow-hidden rounded-[28px] bg-secondary/30 shadow-[0_18px_44px_-14px_hsl(242_30%_2%/0.9),0_0_0_1px_hsl(0_0%_100%/0.08)]">
            {detail.iconUrl ? (
              <img src={detail.iconUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-primary/10" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="line-clamp-2 text-[2.5rem] font-bold leading-[1.05] tracking-[-0.03em]">{detail.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {t("By")} {detail.author}
              </span>
              {availableSources.length > 1 && onSelectSource ? (
                <span className="inline-flex items-center gap-0.5 rounded-[10px] bg-secondary/50 p-[3px] backdrop-blur-md">
                  {availableSources.map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() => onSelectSource(source)}
                      aria-pressed={source === detail.provider}
                      className={cn(
                        "rounded-[7px] px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow] duration-200",
                        source === detail.provider
                          ? "bg-background text-foreground shadow-[0_1px_3px_hsl(242_30%_2%/0.45)]"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {providerLabel(source)}
                    </button>
                  ))}
                </span>
              ) : (
                <ProviderBadge provider={detail.provider} variant="subtle" className="py-1 text-xs" />
              )}
              {detail.compatible !== null && (
                <span className={cn("inline-flex items-center gap-1.5 font-medium", detail.compatible ? "text-emerald-400" : "text-amber-400")}>
                  {detail.compatible ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                  {detail.compatible ? t("Compatible with this instance") : t("Not built for this instance")}
                </span>
              )}
            </div>
          </div>
          {favoriteButton}
        </header>

        <p className="mt-6 max-w-[68ch] text-[1.0625rem] leading-relaxed text-foreground/85">{detail.description}</p>

        <div className="mt-8 grid gap-10 [@container(min-width:900px)]:grid-cols-[minmax(0,1fr)_21rem]">
          <main className="min-w-0 space-y-8">
            <ProjectGallery images={gallery} projectTitle={detail.title} size="large" />

            <div>
              <div className="flex gap-6 border-b border-border/40">
                {(
                  [
                    ["description", t("Description")],
                    ["versions", t("Versions")],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      "-mb-px min-h-11 border-b-2 pt-1 text-sm font-medium transition-[border-color,color] duration-150",
                      tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="pt-6">
                {tab === "description" &&
                  (page.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("Loading the description…")}
                    </div>
                  ) : data?.body_html.trim() ? (
                    // Cleaned in the launcher before it gets here: no script,
                    // frame, style or handler survives; see project_page.rs.
                    <div className="kiza-prose" onClick={openLink} dangerouslySetInnerHTML={{ __html: data.body_html }} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{detail.description || t("This project has no description.")}</p>
                  ))}
                {tab === "versions" && versionsBody}
              </div>
            </div>
          </main>

          <aside className="space-y-6 self-start [@container(min-width:900px)]:sticky [@container(min-width:900px)]:top-6">
            <div className="rounded-2xl bg-card/70 p-5 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.08),0_20px_50px_-24px_hsl(0_0%_0%/0.8)] backdrop-blur-xl">
              {installBody}
            </div>

            <dl className="space-y-3 px-1">
              {facts
                .filter((fact) => fact.value)
                .map((fact) => (
                  <div key={fact.label} className="flex items-center gap-3 text-sm">
                    <fact.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <dt className="min-w-0 flex-1 text-muted-foreground first-letter:uppercase">{fact.label}</dt>
                    <dd className="truncate font-semibold tabular-nums">{fact.value}</dd>
                  </div>
                ))}
            </dl>

            {data && data.game_versions.length > 0 && (
              <Chips title={t("Minecraft versions")} items={data.game_versions} limit={14} />
            )}
            {data && data.loaders.length > 0 && <Chips title={t("Modloaders")} items={data.loaders} capitalise />}
            {data && data.categories.length > 0 && <Chips title={t("Categories")} items={data.categories} capitalise />}

            {data && data.links.length > 0 && (
              <div className="space-y-1">
                <div className="px-1 pb-1 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">{t("Links")}</div>
                {data.links.map((link) => {
                  const Icon = LINK_ICONS[link.kind] ?? Globe;
                  return (
                    <button
                      key={`${link.kind}:${link.url}`}
                      type="button"
                      onClick={() => void openUrl(link.url)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-[background-color] duration-150 hover:bg-secondary/40"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{t(LINK_LABELS[link.kind] ?? "Website")}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Chips({ title, items, limit, capitalise }: { title: string; items: string[]; limit?: number; capitalise?: boolean }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const shown = limit && !all ? items.slice(0, limit) : items;
  const hidden = items.length - shown.length;
  return (
    <div>
      <div className="px-1 pb-2 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((item) => (
          <span key={item} className={cn("rounded-md bg-secondary/45 px-2 py-1 text-xs tabular-nums text-foreground/85", capitalise && "capitalize")}>
            {item.replace(/-/g, " ")}
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-[background-color] duration-150 hover:bg-primary/10"
          >
            {t("+{count} more").replace("{count}", String(hidden))}
          </button>
        )}
      </div>
    </div>
  );
}
