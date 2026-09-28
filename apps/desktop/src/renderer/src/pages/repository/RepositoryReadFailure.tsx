import { Icon } from "../../shared/ui/Icon";

export function RepositoryReadFailure({
  label
}: {
  label: string;
}) {
  return (
    <div className="empty-state repository-empty-state">
      <span className="empty-state-icon warning-icon">
        <Icon name="warning" size={20} />
      </span>
      <div>
        <strong>{label}</strong>
        <p>已保留其他成功读取的数据，可使用“重新读取”重试。</p>
      </div>
    </div>
  );
}
