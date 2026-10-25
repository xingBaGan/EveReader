import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/useAuthStore';
import { useDomainStore } from '../stores/useDomainStore';
import { zlibApi } from '../api/endpoints';
import {
  User as UserIcon,
  Globe,
  RefreshCw,
  LogOut,
  ShieldCheck,
  DownloadCloud,
  CheckCircle2,
} from 'lucide-react-native';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const currentBaseUrl = useDomainStore((s) => s.currentBaseUrl);
  const customProxyUrl = useDomainStore((s) => s.customProxyUrl);
  const candidateDomains = useDomainStore((s) => s.candidateDomains);
  const isProbing = useDomainStore((s) => s.isProbing);
  const probeFastestDomain = useDomainStore((s) => s.probeFastestDomain);
  const setCustomProxyUrl = useDomainStore((s) => s.setCustomProxyUrl);
  const setCurrentBaseUrl = useDomainStore((s) => s.setCurrentBaseUrl);

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Proxy input
  const [proxyInput, setProxyInput] = useState(customProxyUrl);

  React.useEffect(() => {
    if (customProxyUrl) {
      setProxyInput(customProxyUrl);
    }
  }, [customProxyUrl]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setLoginError('请输入账号与密码');
      return;
    }
    try {
      setIsLoggingIn(true);
      setLoginError('');
      const res = await zlibApi.login(email.trim(), password.trim());
      if (res.success === 1 && res.user) {
        await setUser(res.user);
        setEmail('');
        setPassword('');
      } else {
        setLoginError(res.error || '登录失败，请检查账号或密码');
      }
    } catch (err: any) {
      setLoginError(err.response?.data?.error || err.message || '网络连接异常');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSaveProxy = () => {
    setCustomProxyUrl(proxyInput);
    Alert.alert('设置成功', proxyInput ? '已启用自定义代理镜像' : '已重置为默认官方镜像');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.screenTitle}>个人中心与设置</Text>

        {/* User Card */}
        {user ? (
          <View style={styles.card}>
            <View style={styles.userHeader}>
              <View style={styles.avatar}>
                <UserIcon size={24} color="#38bdf8" />
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{user.name || 'Z-Library 会员'}</Text>
                <Text style={styles.userEmail}>{user.email}</Text>
              </View>
              {user.isPremium === 1 ? (
                <View style={styles.premiumBadge}>
                  <ShieldCheck size={12} color="#fbbf24" />
                  <Text style={styles.premiumText}>VIP</Text>
                </View>
              ) : null}
            </View>

            {/* Quota Row */}
            <View style={styles.quotaRow}>
              <View style={styles.quotaItem}>
                <DownloadCloud size={16} color="#94a3b8" />
                <Text style={styles.quotaLabel}>今日已下载</Text>
                <Text style={styles.quotaValue}>{user.downloads_today} 本</Text>
              </View>
              <View style={styles.quotaDivider} />
              <View style={styles.quotaItem}>
                <ShieldCheck size={16} color="#94a3b8" />
                <Text style={styles.quotaLabel}>每日额度上限</Text>
                <Text style={styles.quotaValue}>{user.downloads_limit} 本/天</Text>
              </View>
            </View>

            <View style={styles.kindleRow}>
              <Text style={styles.kindleLabel}>Kindle 推送邮箱:</Text>
              <Text style={styles.kindleValue}>{user.kindle || '未设置 (需在官网绑定)'}</Text>
            </View>

            <Pressable style={styles.logoutBtn} onPress={logout}>
              <LogOut size={16} color="#f87171" />
              <Text style={styles.logoutBtnText}>退出当前账号</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>登录 Z-Library 账号</Text>
            <Text style={styles.cardSubtitle}>
              登录后可同步每日免费下载额度（10本/天）、云端书单及个人专属穿透域名。
            </Text>

            {loginError ? <Text style={styles.errorBanner}>{loginError}</Text> : null}

            <TextInput
              style={styles.input}
              placeholder="电子邮箱 (Email)"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              placeholder="密码 (Password)"
              placeholderTextColor="#64748b"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <Pressable
              style={[styles.loginBtn, isLoggingIn && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={isLoggingIn}>
              {isLoggingIn ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.loginBtnText}>立即登录</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* Network & Mirror Settings */}
        <View style={styles.card}>
          <View style={styles.cardHeaderWithAction}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Globe size={18} color="#38bdf8" />
              <Text style={styles.cardTitle}>网络穿透与镜像池</Text>
            </View>
            <Pressable
              style={styles.probeBtn}
              onPress={() => probeFastestDomain()}
              disabled={isProbing}>
              {isProbing ? (
                <ActivityIndicator size="small" color="#38bdf8" />
              ) : (
                <>
                  <RefreshCw size={12} color="#38bdf8" />
                  <Text style={styles.probeBtnText}>一键测速选路</Text>
                </>
              )}
            </Pressable>
          </View>

          <Text style={styles.cardSubtitle}>
            当官方常规域名遇到阻断时，系统会自动在可用镜像节点中竞速选优。
          </Text>

          {/* Current Domain */}
          <View style={styles.activeDomainBox}>
            <Text style={styles.activeDomainLabel}>当前生效的 API 节点：</Text>
            <Text style={styles.activeDomainUrl}>{currentBaseUrl}</Text>
          </View>

          {/* Custom Proxy Input */}
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>自定义反代 / 镜像域名 (国内免翻直连)</Text>
          <View style={styles.proxyInputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="例如: https://my-proxy.workers.dev"
              placeholderTextColor="#64748b"
              value={proxyInput}
              onChangeText={setProxyInput}
              autoCapitalize="none"
            />
            <Pressable style={styles.saveProxyBtn} onPress={handleSaveProxy}>
              <Text style={styles.saveProxyText}>保存</Text>
            </Pressable>
          </View>

          {/* Candidate Mirrors */}
          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>官方候选节点池：</Text>
          <View style={styles.domainList}>
            {candidateDomains.map((dom) => {
              const isSelected = dom === currentBaseUrl;
              return (
                <Pressable
                  key={dom}
                  style={[styles.domainItem, isSelected && styles.domainItemActive]}
                  onPress={() => setCurrentBaseUrl(dom)}>
                  <Text style={[styles.domainItemText, isSelected && styles.domainItemTextActive]}>
                    {dom}
                  </Text>
                  {isSelected ? <CheckCircle2 size={16} color="#38bdf8" /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 90,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    lineHeight: 18,
  },
  cardHeaderWithAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  userEmail: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#78350f',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  premiumText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
  },
  quotaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  quotaItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  quotaDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#334155',
  },
  quotaLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  quotaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38bdf8',
  },
  kindleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  kindleLabel: {
    fontSize: 12,
    color: '#94a3b8',
  },
  kindleValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f8fafc',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  logoutBtnText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: '#450a0a',
    color: '#fca5a5',
    fontSize: 12,
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    color: '#f8fafc',
    fontSize: 14,
    marginTop: 10,
  },
  loginBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  probeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  probeBtnText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '600',
  },
  activeDomainBox: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  activeDomainLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  activeDomainUrl: {
    fontSize: 13,
    color: '#38bdf8',
    fontWeight: '600',
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  proxyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  saveProxyBtn: {
    backgroundColor: '#0284c7',
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveProxyText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  domainList: {
    marginTop: 8,
    gap: 6,
  },
  domainItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  domainItemActive: {
    borderWidth: 1,
    borderColor: '#0284c7',
  },
  domainItemText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  domainItemTextActive: {
    color: '#f8fafc',
    fontWeight: '600',
  },
});
