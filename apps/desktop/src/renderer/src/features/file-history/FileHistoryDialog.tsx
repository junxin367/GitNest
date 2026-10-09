import { memo } from "react";
import type { FileHistoryEntryDto, FileHistoryResultDto } from "@gitnest/contracts";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { DiffPanel } from "../../widgets/diff-workspace/DiffPanel";
import { standaloneDiffWorkspaceConfiguration } from "../../widgets/diff-workspace/diffWorkspaceConfiguration";
import { useFileHistory, type FileHistoryScope } from "./useFileHistory";
import "./file-history.css";

export interface FileHistoryDialogProps extends FileHistoryScope {
  onDismiss(): void;
}
const diffConfig = { ...standaloneDiffWorkspaceConfiguration.document, allowContextExpansion: false };

/** A scope key resets both data and pending requests before a different file is shown. */
export function FileHistoryDialog(props: FileHistoryDialogProps) {
  const key = JSON.stringify([props.target.repositoryId, props.target.worktreeId, props.path, props.originalPath, props.revision]);
  return <FileHistoryContent key={key} {...props} />;
}

function FileHistoryContent(props: FileHistoryDialogProps) {
  const model = useFileHistory(props);
  const selectedKey = `${model.selected?.hash}:${model.selected?.path}`;
  const { setSelected } = model;
  const dismiss = () => { model.cancel(); props.onDismiss(); };
  const diff = model.diff.value;
  const binaryDiff = Boolean(diff && /^(?:Binary files |GIT binary patch)/m.test(diff.patch));
  const metadataOnlyDiff = diff?.status === "ok" && !binaryDiff && !/^@@+ /m.test(diff.patch);
  return <Dialog icon="history" title="文件历史" size="complex" className="file-history-dialog"
    bodyClassName="file-history-body" onDismiss={dismiss}
    footer={<Button onClick={dismiss}>关闭</Button>}>
    <div className="file-history-layout">
      <div className="file-history-sidebar">
        <div className="file-history-heading">
          <strong title={props.path}>{props.path}</strong>
          <span>只读已提交版本 · {model.history?.revision ? model.history.revision.slice(0, 8) : props.revision?.slice(0, 8) || "HEAD"}</span>
        </div>
        {model.historyError && <div role="alert">{model.historyError}{" "}
          <Button disabled={model.historyLoading} onClick={() => model.history ? void model.loadMore() : model.retry()}>重试读取</Button>
        </div>}
        {!model.history && model.historyLoading && <p role="status">正在读取文件历史…</p>}
        {model.history && model.history.entries.length === 0 && <p role="status">
          {model.history.message || "此路径没有已提交历史。未跟踪文件或尚无提交的仓库没有可追溯记录。"}
        </p>}
        {model.history && model.history.entries.length > 0 &&
          <HistoryList history={model.history} selectedKey={selectedKey} loading={model.historyLoading}
            onSelect={setSelected} onLoadMore={model.loadMore} />}
      </div>
      <section className="file-history-detail" aria-label="所选文件版本">
        {model.selected &&
          <div className="file-history-panel" role="region" aria-label="提交变更" tabIndex={0}>
            {model.diff.error && <p role="alert">{model.diff.error}{" "}<Button onClick={model.retryDetail}>重试读取变更</Button></p>}
            {diff?.message && <p role="status">{diff.message}</p>}
            <DiffPanel config={diffConfig} scopeKey={selectedKey} path={model.selected.path}
              content={diff?.patch ?? ""} keyboardShortcutsEnabled={false}
              binary={binaryDiff}
              truncated={diff?.status === "too-large"}
              state={model.diff.loading ? { icon: "refresh", title: "正在读取提交变更…", message: "", busy: true }
                : model.diff.error ? { icon: "warning", title: "无法读取变更", message: model.diff.error }
                  : diff?.status === "empty" ? { icon: "fileCode", title: "没有文本变更", message: diff.message ?? "此提交没有可显示的文件变更。" }
                    : metadataOnlyDiff ? {
                      icon: "fileCode", title: "没有文本行变更",
                      message: model.selected.previousPath
                        ? `文件重命名：${model.selected.previousPath} → ${model.selected.path}。此提交未改变文本行内容。`
                        : "此提交仅变更文件路径或文件属性，未改变文本行内容。"
                    } : undefined} />
          </div>
        }
      </section>
    </div>
  </Dialog>;
}

const HistoryList = memo(function HistoryList({ history, selectedKey, loading, onSelect, onLoadMore }: {
  history: FileHistoryResultDto;
  selectedKey: string;
  loading: boolean;
  onSelect(entry: FileHistoryEntryDto): void;
  onLoadMore(): Promise<void>;
}) {
  return <section className="file-history-list" aria-label="文件提交历史">
    <p className="file-history-caption">已加载 {history.entries.length} 条 · 每次 50 条 · 跟随重命名</p>
    <ol>{history.entries.map(entry => <HistoryRow key={`${entry.hash}:${entry.path}`} entry={entry}
      selected={`${entry.hash}:${entry.path}` === selectedKey} onSelect={onSelect} />)}</ol>
    {history.message && <p role="status">{history.message}</p>}
    {history.nextOffset !== null
      ? <Button fullWidth loading={loading} onClick={() => void onLoadMore()}>加载更多历史</Button>
      : <p className="file-history-caption">已到当前历史范围末尾</p>}
  </section>;
});

const HistoryRow = memo(function HistoryRow({ entry, selected, onSelect }: {
  entry: FileHistoryEntryDto; selected: boolean; onSelect(entry: FileHistoryEntryDto): void;
}) {
  return <li><Button variant="unstyled" className="file-history-entry" aria-current={selected ? "true" : undefined}
    onClick={() => onSelect(entry)}>
    <strong>{entry.subject}</strong>
    <span>{entry.hash.slice(0, 8)} · {entry.authorName}</span>
    <time dateTime={entry.authoredAt}>{formatDate(entry.authoredAt)}</time>
    <span className="file-history-path">{entry.previousPath ? `${entry.previousPath} → ` : ""}{entry.path}</span>
  </Button></li>;
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
