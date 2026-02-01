import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";

export interface ScrollableContainerProps {
  /** The content items to display */
  children: React.ReactNode[];
  /** Maximum height in lines (excluding header/footer) */
  maxHeight: number;
  /** Current highlighted/selected index (for auto-scrolling to selection) */
  highlightedIndex?: number;
  /** Whether this component has focus for keyboard input (for Page Up/Down) */
  isFocused?: boolean;
  /** Callback when scroll position changes via Page Up/Down */
  onScroll?: (direction: "up" | "down", amount: number) => void;
  /** Header element to display above scrollable content */
  header?: React.ReactNode;
  /** Footer element to display below scrollable content */
  footer?: React.ReactNode;
  /** Show scroll indicators on the right side */
  showScrollIndicators?: boolean;
  /** Border style for the container */
  borderStyle?:
    | "single"
    | "double"
    | "round"
    | "bold"
    | "singleDouble"
    | "doubleSingle"
    | "classic";
  /** Border color */
  borderColor?: string;
  /** Padding on the X axis */
  paddingX?: number;
  /** Width of the container */
  width?: number;
  /** Flex grow value */
  flexGrow?: number;
}

/**
 * ScrollableContainer provides a viewport for content that may overflow.
 * Features:
 * - Auto-scroll to keep highlighted item visible
 * - Page Up/Down keyboard shortcuts for faster scrolling
 * - Scroll indicators (arrows) when content overflows
 */
export function ScrollableContainer({
  children,
  maxHeight,
  highlightedIndex = 0,
  isFocused = true,
  onScroll,
  header,
  footer,
  showScrollIndicators = true,
  borderStyle = "single",
  borderColor = "gray",
  paddingX = 1,
  width,
  flexGrow,
}: ScrollableContainerProps): React.ReactElement {
  const totalItems = children.length;
  const [scrollOffset, setScrollOffset] = useState(0);

  // Calculate visible range
  const visibleItems = useMemo(() => {
    const startIndex = scrollOffset;
    const endIndex = Math.min(scrollOffset + maxHeight, totalItems);
    return children.slice(startIndex, endIndex);
  }, [children, scrollOffset, maxHeight, totalItems]);

  // Check if we can scroll
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxHeight < totalItems;
  const hasOverflow = totalItems > maxHeight;

  // Auto-scroll to keep highlighted item visible
  useEffect(() => {
    if (highlightedIndex < scrollOffset) {
      // Item is above viewport - scroll up
      setScrollOffset(highlightedIndex);
    } else if (highlightedIndex >= scrollOffset + maxHeight) {
      // Item is below viewport - scroll down
      setScrollOffset(highlightedIndex - maxHeight + 1);
    }
  }, [highlightedIndex, scrollOffset, maxHeight]);

  // Handle Page Up/Down keys
  const handlePageUp = useCallback(() => {
    const newOffset = Math.max(0, scrollOffset - maxHeight);
    setScrollOffset(newOffset);
    if (onScroll) {
      onScroll("up", maxHeight);
    }
  }, [scrollOffset, maxHeight, onScroll]);

  const handlePageDown = useCallback(() => {
    const maxOffset = Math.max(0, totalItems - maxHeight);
    const newOffset = Math.min(maxOffset, scrollOffset + maxHeight);
    setScrollOffset(newOffset);
    if (onScroll) {
      onScroll("down", maxHeight);
    }
  }, [scrollOffset, maxHeight, totalItems, onScroll]);

  // Handle keyboard input for Page Up/Down
  useInput(
    (_input, key) => {
      if (!isFocused) return;

      if (key.pageUp) {
        handlePageUp();
      } else if (key.pageDown) {
        handlePageDown();
      }
    },
    { isActive: isFocused },
  );

  // Build the container with optional scroll indicators
  const containerProps: Record<string, unknown> = {
    flexDirection: "column",
    borderStyle,
    borderColor,
    paddingX,
  };

  if (width !== undefined) {
    containerProps.width = width;
  }
  if (flexGrow !== undefined) {
    containerProps.flexGrow = flexGrow;
  }

  return (
    <Box {...containerProps}>
      {/* Header */}
      {header}

      {/* Scrollable content area */}
      <Box flexDirection="column">
        {/* Up scroll indicator */}
        {showScrollIndicators && hasOverflow && (
          <Box justifyContent="flex-end">
            <Text color={canScrollUp ? "cyan" : "gray"} dimColor={!canScrollUp}>
              {canScrollUp ? "▲ more" : ""}
            </Text>
          </Box>
        )}

        {/* Visible items */}
        {visibleItems}

        {/* Down scroll indicator */}
        {showScrollIndicators && hasOverflow && (
          <Box justifyContent="flex-end">
            <Text color={canScrollDown ? "cyan" : "gray"} dimColor={!canScrollDown}>
              {canScrollDown ? "▼ more" : ""}
            </Text>
          </Box>
        )}
      </Box>

      {/* Footer */}
      {footer}
    </Box>
  );
}

export default ScrollableContainer;
