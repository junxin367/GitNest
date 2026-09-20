import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState
} from "react";

import { Button, type ButtonSize } from "./Button";
import { Icon } from "./Icon";
import {
  isEventInsideMenu,
  MenuItem,
  MenuPopover
} from "./Menu";

export interface SelectOption<Value extends string> {
  disabled?: boolean;
  label: ReactNode;
  leading?: ReactNode;
  title?: string;
  value: Value;
}

export interface SelectProps<Value extends string> {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  id?: string;
  label?: ReactNode;
  menuAriaLabel?: string;
  menuClassName?: string;
  onChange(value: Value): void;
  options: readonly SelectOption<Value>[];
  placeholder?: ReactNode;
  size?: ButtonSize;
  triggerClassName?: string;
  value?: Value | undefined;
}

export function Select<Value extends string>({
  ariaLabel,
  className,
  disabled = false,
  fullWidth = false,
  id,
  label,
  menuAriaLabel,
  menuClassName,
  onChange,
  options,
  placeholder = "请选择",
  size = "medium",
  triggerClassName,
  value
}: SelectProps<Value>) {
  const [open, setOpen] = useState(false);
  const generatedId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = id ?? `gn-select-${generatedId}`;
  const menuId = `${triggerId}-menu`;
  const selectedOption = options.find(
    (option) => option.value === value
  );
  const resolvedDisabled =
    disabled ||
    options.length === 0 ||
    options.every((option) => option.disabled);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (resolvedDisabled) {
      setOpen(false);
      return;
    }

    const close = () => setOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    const handleScroll = (event: Event) => {
      if (isEventInsideMenu(event, menuRef.current)) {
        return;
      }
      close();
    };
    const focusFrame = window.requestAnimationFrame(() => {
      const items =
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]:not(:disabled)'
        ) ?? [];
      const current = [...items].find(
        (item) => item.getAttribute("aria-checked") === "true"
      );
      (current ?? items[0])?.focus();
    });

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, resolvedDisabled]);

  const triggerWidth =
    triggerRef.current?.getBoundingClientRect().width ?? 0;
  const menuStyle: CSSProperties | undefined =
    triggerWidth > 0 ? { width: triggerWidth } : undefined;

  return (
    <div
      className={mergeClassNames("gn-select-field", className)}
      data-disabled={resolvedDisabled}
      data-full-width={fullWidth}
    >
      {label ? (
        <span className="gn-select-field__label">{label}</span>
      ) : null}
      <div className="gn-select" data-open={open}>
        <Button
          aria-controls={open ? menuId : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={ariaLabel}
          className={mergeClassNames(
            "gn-select__trigger",
            triggerClassName
          )}
          disabled={resolvedDisabled}
          fullWidth
          icon={<Icon name="chevron" size={14} />}
          iconPosition="after"
          id={triggerId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          ref={triggerRef}
          size={size}
          type="button"
        >
          <span className="gn-select__value">
            {selectedOption?.leading ? (
              <span className="gn-select__value-leading">
                {selectedOption.leading}
              </span>
            ) : null}
            <span className="gn-select__value-label">
              {selectedOption?.label ?? placeholder}
            </span>
          </span>
        </Button>
        {open && (
          <MenuPopover
            align="start"
            anchor={triggerRef.current}
            aria-label={menuAriaLabel ?? `${ariaLabel}选项`}
            className={mergeClassNames(
              "gn-select__menu",
              menuClassName
            )}
            id={menuId}
            ref={menuRef}
            side="bottom"
            style={menuStyle}
          >
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <MenuItem
                  aria-checked={selected}
                  className={selected ? "is-selected" : undefined}
                  disabled={option.disabled}
                  key={option.value}
                  leading={option.leading}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  role="menuitemradio"
                  title={option.title}
                  trailing={
                    selected ? (
                      <Icon name="check" size={12} />
                    ) : undefined
                  }
                >
                  {option.label}
                </MenuItem>
              );
            })}
          </MenuPopover>
        )}
      </div>
    </div>
  );
}

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
