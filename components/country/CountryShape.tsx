/**
 * Sprint 17 S17.9 — country silhouette renderer.
 *
 * Renders a small SVG silhouette of a country (sourced from mapsicon) when
 * the ISO 3166-1 alpha-2 `code` is known. When the code is unknown — or no
 * shape asset has been bundled for it — falls back to the previous
 * 2-letter monogram badge so the row layout never breaks.
 *
 * The shape paths live in `assets/country-shapes/<ISO2>.ts` and are
 * looked up via `getCountryShape`. The component intentionally does not
 * import the per-country modules eagerly — index.ts statically imports
 * them once so Metro can tree-shake duplicates, but the lookup at render
 * time is an O(1) record access.
 */

import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {G, Path} from 'react-native-svg';
import {getCountryShape} from '@/assets/country-shapes';

interface CountryShapeProps {
  /**
   * ISO 3166-1 alpha-2 code (case-insensitive). When undefined or
   * unmapped, the component renders the `fallbackText` monogram.
   */
  code?: string | null;
  /**
   * Total render size in points. The SVG is squared inside this box; the
   * monogram fallback uses the same dimensions.
   */
  size: number;
  /**
   * Fill color for the silhouette and text color for the monogram
   * fallback.
   */
  color: string;
  /**
   * Two-letter fallback text shown when no shape is available. Pass the
   * ISO code itself (preferred) or the first two letters of the country
   * name as a last resort. If omitted, the fallback renders an empty
   * box — callers should always provide this.
   */
  fallbackText?: string;
}

function CountryShape({code, size, color, fallbackText}: CountryShapeProps) {
  const shape = code ? getCountryShape(code) : undefined;

  const styles = useMemo(() => createStyles(size, color), [size, color]);

  if (!shape) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText} numberOfLines={1}>
          {fallbackText ?? ''}
        </Text>
      </View>
    );
  }

  return (
    <Svg
      width={size}
      height={size}
      viewBox={shape.viewBox}
      accessibilityIgnoresInvertColors>
      {shape.transform ? (
        <G transform={shape.transform}>
          {shape.paths.map((d, i) => (
            <Path key={i} d={d} fill={color} />
          ))}
        </G>
      ) : (
        shape.paths.map((d, i) => <Path key={i} d={d} fill={color} />)
      )}
    </Svg>
  );
}

function createStyles(size: number, color: string) {
  return StyleSheet.create({
    fallback: {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fallbackText: {
      fontSize: Math.max(9, size * 0.42),
      fontFamily: 'Manrope-ExtraBold',
      color,
      letterSpacing: 1,
    },
  });
}

export default React.memo(CountryShape);
