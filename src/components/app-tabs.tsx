import React from 'react';
import { View, StyleSheet, Pressable, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
} from 'expo-router/ui';
import { Compass, Search, BookMarked, User, type LucideIcon } from 'lucide-react-native';
import { useColorScheme } from 'react-native';
import { MD3Colors } from '@/constants/theme';

interface TabConfig {
  name: string;
  href: '/' | '/search' | '/shelf' | '/profile';
  label: string;
  icon: LucideIcon;
}

const TABS: TabConfig[] = [
  { name: 'index', href: '/', label: '发现', icon: Compass },
  { name: 'search', href: '/search', label: '搜索', icon: Search },
  { name: 'shelf', href: '/shelf', label: '书架', icon: BookMarked },
  { name: 'profile', href: '/profile', label: '我的', icon: User },
];

interface TabButtonProps {
  isFocused?: boolean;
  onPress?: (e: any) => void;
  onLongPress?: (e: any) => void;
  icon: LucideIcon;
  label: string;
  isDark: boolean;
}

function TabButton({
  isFocused,
  onPress,
  onLongPress,
  icon: Icon,
  label,
  isDark,
}: TabButtonProps) {
  const activeColor = isDark ? '#9ECAFF' : '#0061A4';
  const inactiveColor = isDark ? '#938F99' : '#79747E';
  const activeBg = isDark ? 'rgba(158, 202, 255, 0.16)' : 'rgba(0, 97, 164, 0.12)';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.tabButton,
        pressed && styles.pressed,
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}>
      <View
        style={[
          styles.pillContainer,
          isFocused && { backgroundColor: activeBg },
        ]}>
        <Icon
          size={21}
          strokeWidth={isFocused ? 2.4 : 1.9}
          color={isFocused ? activeColor : inactiveColor}
        />
      </View>
      <Text
        style={[
          styles.label,
          {
            color: isFocused ? activeColor : inactiveColor,
            fontWeight: isFocused ? '600' : '400',
          },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function AppTabs() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const insets = useSafeAreaInsets();
  const colors = MD3Colors[isDark ? 'dark' : 'light'];

  const bottomPadding = Math.max(insets.bottom, 8);

  return (
    <Tabs style={[styles.root, { backgroundColor: colors.background }]}>
      <TabSlot style={styles.slot} />
      <TabList
        style={[
          styles.tabBar,
          {
            backgroundColor: isDark ? '#16141A' : '#FFFFFF',
            borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
            paddingBottom: bottomPadding,
            height: 56 + bottomPadding,
          },
        ]}>
        {TABS.map((tab) => (
          <TabTrigger
            key={tab.name}
            name={tab.name}
            href={tab.href}
            asChild
            style={styles.triggerSlot}>
            <TabButton
              icon={tab.icon}
              label={tab.label}
              isDark={isDark}
            />
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  slot: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.05)',
      },
    }),
  },
  triggerSlot: {
    flex: 1,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  pressed: {
    opacity: 0.75,
  },
  pillContainer: {
    width: 52,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
