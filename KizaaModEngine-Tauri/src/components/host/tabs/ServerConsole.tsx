import { useEffect, useRef, useState } from "react";
import { ArrowDown, Eraser, Send, Terminal } from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { isUp, useSendServerCommand, useServerConsole, type ConsoleLine, type HostedServer } from "../../../lib/hostQueries";
import { formatConsoleTime } from "../format";

const QUICK_COMMANDS = ["list", "save-all", "time set day", "weather clear", "whitelist list"];
const LEVEL_RE = /\/(INFO|WARN|ERROR|FATAL|DEBUG)\]/;

/**
 * The server's console: what it prints, and a line to type into it.
 *
 * Kept flat on purpose: two thousand plain rows scroll fine, and the ring on
 * the other side never hands over more than that. The view follows the tail
 * until the user scrolls up, then leaves them where they are and offers a
 * way back down.
 */
export function ServerConsole({ server, active }: { server: HostedServer; active: boolean }) {
  const { t } = useI18n();
  const { lines, clear } = useServerConsole(server.id, active);
  const send = useSendServerCommand();
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = isUp(server.status.state) && server.status.state !== "detached";

  useEffect(() => {
    if (!follow || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, follow]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setFollow(atBottom);
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    send.mutate({ serverId: server.id, command: trimmed });
    setHistory((current) => [trimmed, ...current.filter((c) => c !== trimmed)].slice(0, 50));
    setHistoryAt(-1);
    setCommand("");
    setFollow(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_COMMANDS.map((quick) => (
          <button
            key={quick}
            type="button"
            disabled={!running}
            onClick={() => submit(quick)}
            className="rounded-full border border-border/70 bg-secondary/20 px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
          >
            {quick}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void clear()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border/70 px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Eraser className="h-3.5 w-3.5" />
          {t("Clear")}
        </button>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-[420px] overflow-y-auto rounded-xl border border-border/60 bg-black/50 p-3 font-mono text-[12.5px] leading-5"
        >
          {lines.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-muted-foreground">
              <Terminal className="h-4 w-4" />
              {running ? t("Nothing yet.") : t("Start the server to see its console.")}
            </p>
          ) : (
            lines.map((line) => <Line key={line.seq} line={line} />)
          )}
        </div>
        {!follow && (
          <button
            type="button"
            onClick={() => {
              setFollow(true);
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-primary/50 bg-background/90 px-3 py-1 text-xs text-primary shadow"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {t("Follow")}
          </button>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(command);
        }}
        className="flex items-center gap-2"
      >
        <span className="font-mono text-muted-foreground">&gt;</span>
        <input
          ref={inputRef}
          value={command}
          disabled={!running}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && history.length) {
              event.preventDefault();
              const next = Math.min(historyAt + 1, history.length - 1);
              setHistoryAt(next);
              setCommand(history[next]);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              const next = Math.max(historyAt - 1, -1);
              setHistoryAt(next);
              setCommand(next === -1 ? "" : history[next]);
            }
          }}
          placeholder={running ? t("say Hello, op Player, save-all…") : t("The server is not running")}
          aria-label={t("Server command")}
          className="kiza-input h-11 min-w-0 flex-1 border px-3 font-mono text-sm outline-none focus:border-primary/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!running || !command.trim()}
          className="kiza-action inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {t("Send")}
        </button>
      </form>
    </div>
  );
}

function Line({ line }: { line: ConsoleLine }) {
  const level = LEVEL_RE.exec(line.text)?.[1];
  const tone =
    line.stream === "in"
      ? "text-primary"
      : line.stream === "err" || level === "ERROR" || level === "FATAL"
        ? "text-red-300"
        : level === "WARN"
          ? "text-amber-300"
          : "text-foreground/85";
  return (
    <div className={cn("flex gap-3 whitespace-pre-wrap break-words", tone)}>
      <span className="shrink-0 select-none text-muted-foreground/50">{formatConsoleTime(line.at_ms)}</span>
      <span className="min-w-0">{line.text}</span>
    </div>
  );
}
