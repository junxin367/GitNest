import React, {
  forwardRef,
  type ChangeEvent,
  type KeyboardEvent
} from "react";

import { Button } from "./Button";
import { Icon } from "./Icon";
import { Input } from "./Input";

export interface DiffSearchPopoverProps {
  className?: string;
  countLabel: string;
  hasMatches: boolean;
  inputAriaLabel?: string;
  onChange(event: ChangeEvent<HTMLInputElement>): void;
  onClose(): void;
  onNext(): void;
  onPrevious(): void;
  open?: boolean;
  placeholder?: string;
  searchLabel?: string;
  value: string;
}

export const DiffSearchPopover = forwardRef<
  HTMLInputElement,
  DiffSearchPopoverProps
>(function DiffSearchPopover(
  {
    className,
    countLabel,
    hasMatches,
    inputAriaLabel = "搜索文本",
    onChange,
    onClose,
    onNext,
    onPrevious,
    open = true,
    placeholder = "在当前 Diff 中搜索",
    searchLabel = "在 Diff 中搜索",
    value
  },
  ref
) {
  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (!hasMatches) {
        return;
      }
      if (event.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      aria-label={searchLabel}
      className={mergeClassNames(
        "gn-diff-search-popover",
        className
      )}
      role="search"
    >
      <Input
        aria-label={inputAriaLabel}
        autoComplete="off"
        fieldClassName="gn-diff-search-popover__field"
        fullWidth
        inputClassName="gn-diff-search-popover__input"
        leading={<Icon name="search" size={14} />}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={ref}
        size="small"
        spellCheck={false}
        trailing={
          <span
            aria-live="polite"
            className="gn-input__count gn-diff-search-popover__count"
          >
            {countLabel}
          </span>
        }
        type="search"
        value={value}
      />
      <div className="gn-diff-search-popover__actions">
        <Button
          aria-label="上一个匹配"
          className="gn-diff-search-popover__action"
          disabled={!hasMatches}
          icon={<Icon name="arrowUp" size={13} />}
          onClick={onPrevious}
          size="small"
          title="上一个匹配"
          variant="icon"
        />
        <Button
          aria-label="下一个匹配"
          className="gn-diff-search-popover__action"
          disabled={!hasMatches}
          icon={<Icon name="arrowDown" size={13} />}
          onClick={onNext}
          size="small"
          title="下一个匹配"
          variant="icon"
        />
        <Button
          aria-label="关闭搜索"
          className="gn-diff-search-popover__action"
          icon={<Icon name="close" size={13} />}
          onClick={onClose}
          size="small"
          title="关闭搜索"
          variant="icon"
        />
      </div>
    </div>
  );
});

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
