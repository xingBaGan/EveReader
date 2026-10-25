import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Battery from 'expo-battery';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES } from '../../types/reader';

function formatCurrentTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function ReaderFooterBar() {
  const insets = useSafeAreaInsets();
  const settings = useReaderStore((s) => s.settings);
  const currentPage = useReaderStore((s) => s.currentPage);
  const totalPages = useReaderStore((s) => s.totalPages);
  const currentProgress = useReaderStore((s) => s.currentProgress);

  const [currentTime, setCurrentTime] = useState(formatCurrentTime);
  const [batteryLevel, setBatteryLevel] = useState(0.85);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const footerColor = themeConfig.footerText || '#94a3b8';

  // Clock timer: updates every 10 seconds
  useEffect(() => {
    setCurrentTime(formatCurrentTime());
    const timer = setInterval(() => {
      setCurrentTime(formatCurrentTime());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Battery status
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const level = await Battery.getBatteryLevelAsync();
        if (isMounted && typeof level === 'number' && level >= 0) {
          setBatteryLevel(level);
        }
      } catch {
        // Fallback to default
      }
    })();

    let sub: Battery.Subscription | null = null;
    try {
      sub = Battery.addBatteryLevelListener((e) => {
        if (isMounted && typeof e.batteryLevel === 'number' && e.batteryLevel >= 0) {
          setBatteryLevel(e.batteryLevel);
        }
      });
    } catch {
      // Not supported on platform
    }

    return () => {
      isMounted = false;
      sub?.remove();
    };
  }, []);

  // Compute page label text (NeatReader style: "1 / 2917")
  const pageLabel =
    totalPages > 1
      ? `${currentPage} / ${totalPages}`
      : currentProgress > 0
      ? `${Math.round(currentProgress)}%`
      : '1 / 1';

  // Battery fill percentage clamped between 5% and 100%
  const batteryPct = Math.min(100, Math.max(6, Math.round(batteryLevel * 100)));

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}>
      {/* Left: Battery + Time */}
      <View style={styles.leftGroup}>
        {/* Battery Icon */}
        <View style={styles.batteryContainer}>
          <View style={[styles.batteryFrame, { borderColor: footerColor }]}>
            <View
              style={[
                styles.batteryLevel,
                {
                  backgroundColor: footerColor,
                  width: `${batteryPct}%`,
                },
              ]}
            />
          </View>
          <View style={[styles.batteryTip, { backgroundColor: footerColor }]} />
        </View>

        {/* Current Time (e.g. 05:44) */}
        <Text style={[styles.infoText, { color: footerColor }]}>{currentTime}</Text>
      </View>

      {/* Right: Page number (e.g. 1 / 2917) */}
      <Text style={[styles.infoText, { color: footerColor }]}>{pageLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    zIndex: 25,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  batteryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryFrame: {
    width: 22,
    height: 11,
    borderWidth: 1,
    borderRadius: 2.5,
    padding: 1.5,
    justifyContent: 'center',
  },
  batteryLevel: {
    height: '100%',
    borderRadius: 1,
  },
  batteryTip: {
    width: 2,
    height: 5,
    borderTopRightRadius: 1,
    borderBottomRightRadius: 1,
    marginLeft: 1,
  },
  infoText: {
    fontSize: 12,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
});
