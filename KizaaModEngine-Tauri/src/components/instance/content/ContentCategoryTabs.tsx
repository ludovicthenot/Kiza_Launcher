import { useI18n } from "../../../lib/i18n";
import { useAppStore } from "../../../lib/store";
import { cn } from "../../../lib/utils";
import { CONTENT_CATEGORIES } from "./contentCategories";
import type { ContentCategoryId } from "../../../lib/store";

export function ContentCategoryTabs({ onChange }: { onChange?: (category: ContentCategoryId) => void }) {
  const { t } = useI18n();
  const activeCategory = useAppStore((state) => state.contentCategory);
  const setContentCategory = useAppStore((state) => state.setContentCategory);

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("Content categories")}>
      {CONTENT_CATEGORIES.map((category) => {
        const Icon = category.icon;
        const active = category.id === activeCategory;
        return (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              setContentCategory(category.id);
              onChange?.(category.id);
            }}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-[color,background-color,border-color,transform] active:scale-[0.98]",
              active
                ? "border-primary/50 bg-primary/12 text-primary"
                : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/25 hover:bg-secondary/40 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {t(category.label)}
          </button>
        );
      })}
    </div>
  );
}
