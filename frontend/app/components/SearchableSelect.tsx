'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './SearchableSelect.module.css';

interface SearchableSelectProps {
    label: string;
    options: readonly string[];
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    required?: boolean;
    disabled?: boolean;
    noResultsText?: string;
    helperText?: string;
}

function normalizeOptionSearch(value: string): string {
    return value.trim().toLowerCase();
}

export default function SearchableSelect({
    label,
    options,
    value,
    onChange,
    placeholder,
    required = false,
    disabled = false,
    noResultsText = '未搜索到可选项，不能自定义输入。',
    helperText = '输入关键词后，从下拉结果中选择。',
}: SearchableSelectProps) {
    const [query, setQuery] = useState(value);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputId = useId();
    const listboxId = `${inputId}-listbox`;
    const normalizedQuery = normalizeOptionSearch(query);
    const filteredOptions = options.filter((option) => {
        if (!normalizedQuery) return true;
        return normalizeOptionSearch(option).includes(normalizedQuery);
    });
    const hasNoResults = Boolean(normalizedQuery) && filteredOptions.length === 0;

    useEffect(() => {
        setQuery(value);
    }, [value]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
                setActiveIndex(-1);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, []);

    const selectOption = (option: string) => {
        setQuery(option);
        setIsOpen(false);
        setActiveIndex(-1);
        onChange(option);
    };

    const handleInputChange = (nextValue: string) => {
        setQuery(nextValue);
        setIsOpen(true);
        setActiveIndex(0);

        const trimmedValue = nextValue.trim();
        const exactMatch = options.find((option) => option === trimmedValue);
        if (exactMatch) {
            onChange(exactMatch);
        } else if (value) {
            onChange('');
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((prev) => {
                if (!filteredOptions.length) return -1;
                return prev >= filteredOptions.length - 1 ? 0 : prev + 1;
            });
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((prev) => {
                if (!filteredOptions.length) return -1;
                return prev <= 0 ? filteredOptions.length - 1 : prev - 1;
            });
            return;
        }

        if (event.key === 'Enter' && isOpen) {
            const activeOption = filteredOptions[activeIndex];
            if (activeOption) {
                event.preventDefault();
                selectOption(activeOption);
            }
            return;
        }

        if (event.key === 'Escape') {
            setIsOpen(false);
            setActiveIndex(-1);
        }
    };

    const helperMessage = hasNoResults ? noResultsText : helperText;

    return (
        <div className={styles.field} ref={containerRef}>
            <label className={styles.label} htmlFor={inputId}>{label}</label>
            <div className={styles.control}>
                <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                <input
                    id={inputId}
                    type="text"
                    value={query}
                    onChange={(event) => handleInputChange(event.target.value)}
                    onFocus={() => {
                        setIsOpen(true);
                        setActiveIndex(filteredOptions.length ? 0 : -1);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    required={required}
                    className={styles.input}
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
                />
                <button
                    type="button"
                    className={styles.toggleButton}
                    onClick={() => {
                        if (disabled) return;
                        setIsOpen((prev) => !prev);
                        setActiveIndex(filteredOptions.length ? 0 : -1);
                    }}
                    aria-label={`展开${label}选项`}
                    disabled={disabled}
                >
                    <ChevronDown size={16} className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} />
                </button>
                {isOpen && (
                    <div className={styles.dropdown} role="listbox" id={listboxId}>
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, index) => {
                                const isSelected = option === value;
                                const isActive = index === activeIndex;

                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        id={`${listboxId}-${index}`}
                                        className={`${styles.option} ${isActive ? styles.optionActive : ''} ${isSelected ? styles.optionSelected : ''}`}
                                        onMouseEnter={() => setActiveIndex(index)}
                                        onClick={() => selectOption(option)}
                                        role="option"
                                        aria-selected={isSelected}
                                    >
                                        <span>{option}</span>
                                        {isSelected ? <span className={styles.optionTag}>已选</span> : null}
                                    </button>
                                );
                            })
                        ) : (
                            <div className={styles.emptyState}>{noResultsText}</div>
                        )}
                    </div>
                )}
            </div>
            <p className={`${styles.helperText} ${hasNoResults ? styles.helperError : ''}`}>{helperMessage}</p>
        </div>
    );
}
