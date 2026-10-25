import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES, ReaderThemeId } from '../../types/reader';
import { Check } from 'lucide-react-native';

export function ReaderSettingsModal() {
  const isSettingsOpen = useReaderStore((s) => s.isSettingsOpen);
  const setIsSettingsOpen = useReaderStore((s) => s.setIsSettingsOpen);
  const settings = useReaderStore((s) => s.settings);
  const updateSettings = useReaderStore((s) => s.updateSettings);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;

  if (!isSettingsOpen) return null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={isSettingsOpen}
      onRequestClose={() => setIsSettingsOpen(false)}>
      <TouchableWithoutFeedback onPress={() => setIsSettingsOpen(false)}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: themeConfig.barBg,
                  borderColor: themeConfig.barBorder,
                },
              ]}>
              <View style={styles.header}>
                <Text style={[styles.title, { color: themeConfig.barText }]}>阅读设置</Text>
                <Pressable onPress={() => setIsSettingsOpen(false)} style={styles.closeBtn}>
                  <Text style={[styles.closeBtnText, { color: themeConfig.barText }]}>完成</Text>
                </Pressable>
              </View>

              {/* Font Size Row */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: themeConfig.barText }]}>字号大小</Text>
                <View style={styles.fontSizeControls}>
                  <Pressable
                    style={styles.fontBtn}
                    onPress={() =>
                      updateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })
                    }>
                    <Text style={[styles.fontBtnText, { color: themeConfig.barText }]}>A -</Text>
                  </Pressable>
                  <Text style={[styles.fontSizeDisplay, { color: themeConfig.barText }]}>
                    {settings.fontSize} px
                  </Text>
                  <Pressable
                    style={styles.fontBtn}
                    onPress={() =>
                      updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) })
                    }>
                    <Text style={[styles.fontBtnText, { color: themeConfig.barText }]}>A +</Text>
                  </Pressable>
                </View>
              </View>

              {/* Theme Colors */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: themeConfig.barText }]}>阅读背景</Text>
                <View style={styles.themeCircles}>
                  {(Object.keys(READER_THEMES) as ReaderThemeId[]).map((themeKey) => {
                    const t = READER_THEMES[themeKey];
                    const isSelected = settings.theme === themeKey;
                    return (
                      <Pressable
                        key={themeKey}
                        style={[
                          styles.themeCircle,
                          { backgroundColor: t.bg, borderColor: t.barBorder },
                          isSelected && styles.themeCircleSelected,
                        ]}
                        onPress={() => updateSettings({ theme: themeKey })}>
                        {isSelected ? (
                          <Check size={16} color={t.text} />
                        ) : (
                          <Text style={[styles.themeLabel, { color: t.text }]}>
                            {t.name.slice(0, 1)}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Reading Mode (Paginated vs Scrolled) */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: themeConfig.barText }]}>翻页方式</Text>
                <View style={styles.pillContainer}>
                  <Pressable
                    style={[
                      styles.pillBtn,
                      settings.flow === 'paginated' && styles.pillBtnActive,
                    ]}
                    onPress={() => updateSettings({ flow: 'paginated' })}>
                    <Text
                      style={[
                        styles.pillText,
                        { color: themeConfig.barText },
                        settings.flow === 'paginated' && styles.pillTextActive,
                      ]}>
                      左右仿真分页
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.pillBtn,
                      settings.flow === 'scrolled' && styles.pillBtnActive,
                    ]}
                    onPress={() => updateSettings({ flow: 'scrolled' })}>
                    <Text
                      style={[
                        styles.pillText,
                        { color: themeConfig.barText },
                        settings.flow === 'scrolled' && styles.pillTextActive,
                      ]}>
                      上下连续滚动
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Line Spacing */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: themeConfig.barText }]}>行间距</Text>
                <View style={styles.pillContainer}>
                  {[
                    { label: '紧凑', value: 1.4 },
                    { label: '标准', value: 1.6 },
                    { label: '宽松', value: 1.9 },
                  ].map((item) => (
                    <Pressable
                      key={item.label}
                      style={[
                        styles.pillBtn,
                        settings.lineHeight === item.value && styles.pillBtnActive,
                      ]}
                      onPress={() => updateSettings({ lineHeight: item.value })}>
                      <Text
                        style={[
                          styles.pillText,
                          { color: themeConfig.barText },
                          settings.lineHeight === item.value && styles.pillTextActive,
                        ]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Font Family */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: themeConfig.barText }]}>正文字体</Text>
                <View style={styles.pillContainer}>
                  {[
                    { label: '系统黑体', value: 'system' as const },
                    { label: '典雅宋体', value: 'serif' as const },
                    { label: '文艺楷体', value: 'kaiti' as const },
                  ].map((font) => (
                    <Pressable
                      key={font.value}
                      style={[
                        styles.pillBtn,
                        settings.fontFamily === font.value && styles.pillBtnActive,
                      ]}
                      onPress={() => updateSettings({ fontFamily: font.value })}>
                      <Text
                        style={[
                          styles.pillText,
                          { color: themeConfig.barText },
                          settings.fontFamily === font.value && styles.pillTextActive,
                        ]}>
                        {font.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  panel: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.7,
    marginBottom: 8,
  },
  fontSizeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(100, 116, 139, 0.1)',
    borderRadius: 12,
    padding: 4,
  },
  fontBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
  },
  fontBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  fontSizeDisplay: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
  },
  themeCircles: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  themeCircle: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeCircleSelected: {
    borderColor: '#0284c7',
    transform: [{ scale: 1.05 }],
  },
  themeLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  pillContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  pillBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(100, 116, 139, 0.1)',
  },
  pillBtnActive: {
    backgroundColor: '#0284c7',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
  },
});
