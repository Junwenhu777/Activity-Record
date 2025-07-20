import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useState, useEffect, useRef } from 'react';
import { Button, Input, Grid } from 'antd-mobile';
import './App.css';
import * as XLSX from 'xlsx';

const activityTypes = [
  'Moving Around',
  'Eating',
  'Toileting',
  'Dressing',
  'Transferring',
  'Bathing',
];

function formatTime(date: any) {
  if (!(date instanceof Date)) date = new Date(date);
  return date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatHeaderDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}
function formatDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function getDateString(date: Date) {
  // 返回本地年月日字符串，避免UTC偏移
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function groupHistoryByDate(history: any[], beforeDate: Date) {
  const groups: Record<string, any[]> = {};
  history.forEach(item => {
    const dateStr = getDateString(item.endAt);
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(item);
  });
  // 只保留beforeDate（不含）之前的分组
  const beforeStr = getDateString(beforeDate);
  return Object.entries(groups)
    .filter(([date]) => date < beforeStr)
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
    .map(([date, items]) => [date, items.sort((a, b) => b.endAt - a.endAt)] as [string, any[]]);
}

// 格式化秒为hh:mm:ss
function formatHMS(sec: number) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function reviveDate(obj: any): any {
  if (!obj) return obj;
  if (Array.isArray(obj)) {
    return obj.map(reviveDate);
  }
  if (typeof obj === 'object') {
    const copy: any = { ...obj };
    for (const k in copy) {
      if (k === 'startAt' || k === 'endAt') {
        if (copy[k] && typeof copy[k] === 'string') copy[k] = new Date(copy[k]);
      } else if (typeof copy[k] === 'object') {
        copy[k] = reviveDate(copy[k]);
      }
    }
    // 兼容老数据
    if (copy.deleted === undefined) copy.deleted = false;
    return copy;
  }
  return obj;
}

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function formatStartAt(startAt: Date, endAt: Date) {
  if (!isSameDay(startAt, endAt)) {
    return `${formatTime(startAt)} ${String(startAt.getMonth() + 1).padStart(2, '0')}-${String(startAt.getDate()).padStart(2, '0')}`;
  }
  return formatTime(startAt);
}

function formatHeaderDateStr(dateStr: string) {
  const [year, month, day] = dateStr.split('-');
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}



// 根据时间颗粒度分组数据
function groupDataByTimeGranularity(history: any[], current: any, now: Date, granularity: 'Day' | 'Week' | 'Month' | 'Year') {
  const all = [...history].filter(item => !item.deleted);
  if (current) {
    all.unshift({
      name: current.name,
      startAt: current.startAt,
      endAt: now,
      duration: now.getTime() - current.startAt.getTime(),
      deleted: false
    });
  }

  const groups: Record<string, any[]> = {};
  
  all.forEach(item => {
    let groupKey = '';
    const date = new Date(item.endAt);
    
    switch (granularity) {
      case 'Day':
        groupKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        break;
      case 'Week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        groupKey = weekStart.toISOString().split('T')[0];
        break;
      case 'Month':
        groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        break;
      case 'Year':
        groupKey = date.getFullYear().toString(); // YYYY
        break;
    }
    
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(item);
  });

  // 按时间排序并聚合每个时间段的活动
  return Object.entries(groups)
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
    .map(([timeKey, items]) => {
      const summary: Record<string, number> = {};
      items.forEach(item => {
        if (!summary[item.name]) summary[item.name] = 0;
        summary[item.name] += item.duration;
      });
      
      return {
        timeKey,
        activities: Object.entries(summary)
          .map(([name, duration]) => ({ name, duration }))
          .sort((a, b) => b.duration - a.duration)
      };
    });
}

// 格式化时间键显示
function formatTimeKey(timeKey: string, granularity: 'Day' | 'Week' | 'Month' | 'Year') {
  switch (granularity) {
    case 'Day':
      const dayDate = new Date(timeKey);
      return dayDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    case 'Week':
      const weekDate = new Date(timeKey);
      const weekEnd = new Date(weekDate);
      weekEnd.setDate(weekDate.getDate() + 6);
      return `${weekDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}`;
    case 'Month':
      const [year, month] = timeKey.split('-');
      const monthDate = new Date(Number(year), Number(month) - 1);
      return monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'Year':
      return timeKey;
  }
}

function App() {
  useRegisterSW(); // 在组件体内调用
  const [activityName, setActivityName] = useState('');
  const [current, setCurrent] = useState<any>(() => {
    const c = localStorage.getItem('activity-current');
    return c ? reviveDate(JSON.parse(c)) : null;
  });
  const [history, setHistory] = useState<any[]>(() => {
    const h = localStorage.getItem('activity-history');
    return h ? reviveDate(JSON.parse(h)) : [];
  });
  const [now, setNow] = useState(new Date());
  const [showBottomSheet, setShowBottomSheet] = useState(true);
  const [recentActivities, setRecentActivities] = useState<string[]>(() => {
    const r = localStorage.getItem('activity-recent');
    return r ? JSON.parse(r) : [];
  });
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showEndCurrentModal, setShowEndCurrentModal] = useState(false);

  const lastScrollTop = useRef(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);

  // 在App组件内新增state
  const [editingCurrentName, setEditingCurrentName] = useState(false);
  const [editingHistory, setEditingHistory] = useState<{date?: string, idx?: number} | null>(null);
  const [editingName, setEditingName] = useState('');
  // 新增state用于滑动删除
  const [swipeDelete, setSwipeDelete] = useState<{date?: string, idx?: number} | null>(null);

  // 新增 Summary popup 相关状态
  const [showDownloadOptions, setShowDownloadOptions] = useState(false);
  const [timeGranularity, setTimeGranularity] = useState<'Day' | 'Week' | 'Month' | 'Year'>('Day');
  const [chartType, setChartType] = useState<'Bar Chart' | 'Pie Chart'>('Bar Chart');

  // 活动颜色映射 - 确保同一活动在不同时间和图表中使用相同颜色
  const activityColors = useRef<Record<string, string>>({});
  const colorPalette = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', 
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#a6cee3', '#fb9a99', '#fdbf6f', '#cab2d6', '#ffff99'
  ];

  // 获取活动颜色
  const getActivityColor = (activityName: string) => {
    if (!activityColors.current[activityName]) {
      const colorIndex = Object.keys(activityColors.current).length % colorPalette.length;
      activityColors.current[activityName] = colorPalette[colorIndex];
    }
    return activityColors.current[activityName];
  };

  // 用于长按定时器
  let longPressTimer: any = null;

  // 点击外部关闭下载选项
  useEffect(() => {
    const handleClickOutside = () => {
      if (showDownloadOptions) {
        setShowDownloadOptions(false);
      }
    };

    if (showDownloadOptions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDownloadOptions]);

  // localStorage持久化恢复
  useEffect(() => {
    const h = localStorage.getItem('activity-history');
    const c = localStorage.getItem('activity-current');
    const r = localStorage.getItem('activity-recent');
    if (h) setHistory(reviveDate(JSON.parse(h)));
    if (c) setCurrent(reviveDate(JSON.parse(c)));
    if (r) setRecentActivities(JSON.parse(r));
  }, []);
  // localStorage持久化保存
  useEffect(() => {
    localStorage.setItem('activity-history', JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    localStorage.setItem('activity-current', JSON.stringify(current));
  }, [current]);
  useEffect(() => {
    localStorage.setItem('activity-recent', JSON.stringify(recentActivities));
  }, [recentActivities]);

  // 刷新拦截逻辑
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (current) {
        e.preventDefault();
        e.returnValue = '';
        setShowRefreshModal(true);
        
        return '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [current]);

  // 刷新或关闭页面时自动结束当前活动
  useEffect(() => {
    const onBeforeUnload = () => {
      if (current) {
        const endAt = new Date();
        const finished = {
          name: current.name,
          startAt: current.startAt,
          endAt,
          duration: endAt.getTime() - current.startAt.getTime(),
        };
        const h = localStorage.getItem('activity-history');
        const historyArr = h ? reviveDate(JSON.parse(h)) : [];
        historyArr.unshift(finished);
        localStorage.setItem('activity-history', JSON.stringify(historyArr));
        localStorage.removeItem('activity-current');
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [current]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 结束当前活动并记录
  const stopCurrent = () => {
    if (!current) return;
    const endAt = new Date();
    const duration = endAt.getTime() - current.startAt.getTime();
    setHistory([
      { name: current.name, startAt: current.startAt, endAt, duration, deleted: false },
      ...history,
    ]);
    setCurrent(null);
  };

  // 开始新活动（自动结束当前活动）
  const startActivity = (name: string) => {
    if (!name) return;
    if (current) {
      stopCurrent();
    }
    setCurrent({ name, startAt: new Date(), deleted: false });
    setActivityName('');
    
    // 将自定义活动添加到recent列表
    if (!activityTypes.includes(name)) {
      setRecentActivities(prev => {
        const newList = [name, ...prev.filter(item => item !== name)].slice(0, 6);
        return newList;
      });
    }
    
    // 滚动到主内容区顶部
    setTimeout(() => {
      console.log('Attempting to scroll to top...');
      console.log('mainRef.current:', mainRef.current);
      console.log('window.scrollY:', window.scrollY);
      
      // 滚动整个页面到顶部
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      
      // 如果mainRef存在，也尝试滚动它
      if (mainRef.current) {
        console.log('Scrolling main container...');
        mainRef.current.scrollTop = 0;
      }
    }, 200);
  };

  // 滚动监听
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollTop > lastScrollTop.current + 5) {
      // 向上滑动，收起popup
      setShowBottomSheet(false);
    }
    lastScrollTop.current = scrollTop;
  };

  // 下载按钮点击逻辑
  const handleDownloadClick = () => {
    if (current) {
      setShowEndCurrentModal(true);
    } else {
      setShowStatsModal(true);
    }
  };

  // 计算今天0点
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  // 今天的活动
  const todaysActivities = history.filter(item => item.endAt >= todayZero);
  // 历史分组，只显示昨天及以前，分组内最多展示3条
  const groupedHistory = groupHistoryByDate(history, todayZero);
  const displayHistory: [string, any[]][] = groupedHistory as [string, any[]][];

  // 移动端阻止summary弹窗滚动穿透
  useEffect(() => {
    if (!showStatsModal) return;
    const modal = document.querySelector('.modal-content');
    if (!modal) return;
    const stop = (e: Event) => e.stopPropagation();
    modal.addEventListener('touchmove', stop, { passive: false });
    return () => {
      modal.removeEventListener('touchmove', stop);
    };
  }, [showStatsModal]);

  // 顶部时间戳逻辑
  const isToday = (date: Date) => {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
  };

  return (
    <div className="activity-bg">
      <div className="activity-container">
        <div className="activity-header-fixed">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            paddingRight: 12, // 恢复右侧安全边距
          }}>
            <div className="activity-title" style={{ marginLeft: '4px', textAlign: 'left', marginTop: '12px' }}>
              Activity Records
            </div>
            <button 
              onClick={handleDownloadClick}
              style={{
                width: 36, 
                height: 36, 
                borderRadius: '50%', 
                border: '1px solid #bbb',
                background: 'none', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer',
                padding: 0
              }}
            >
              <svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16.0413 16.9216H2.91626V15.7224H16.0413V16.9216ZM10.0784 11.5935L12.9924 8.67944L13.8401 9.5271L9.90259 13.4646C9.66827 13.6989 9.28925 13.6989 9.05493 13.4646L5.11743 9.5271L5.96509 8.67944L8.87915 11.5935V2.54077H10.0784V11.5935Z" fill="black" fillOpacity="0.85"/>
              </svg>
            </button>
          </div>
        </div>
        {/* Summary Popup 窗口 */}
        {showStatsModal && (
          <div className="summary-popup-outer" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.18)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: '24px',
            boxSizing: 'border-box',
          }}>
            <div
              className="summary-popup-content"
              style={{
                background: '#fff',
                borderRadius: '16px 16px 0 0',
                width: '100%',
                maxWidth: '100vw',
                height: 'calc(100vh - 24px)',
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* 标题区 */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                width: '100%', 
                padding: '24px max(12px, env(safe-area-inset-right)) 16px max(12px, env(safe-area-inset-left))',
                borderBottom: '1px solid #f0f0f0',
                boxSizing: 'border-box'
              }}>
                <div style={{ fontWeight: 700, fontSize: 20, color: '#222' }}>Summary</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* 下载按钮 */}
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setShowDownloadOptions(!showDownloadOptions)}
                      style={{
                        width: 40,
                        height: 40,
                        background: '#f5f5f5',
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M15.5625 16.1953H2.4375V14.9961H15.5625V16.1953ZM9.59961 10.8672L12.5137 7.95312L13.3613 8.80078L9.42383 12.7383C9.18952 12.9726 8.81048 12.9726 8.57617 12.7383L4.63867 8.80078L5.48633 7.95312L8.40039 10.8672V1.81445H9.59961V10.8672Z" fill="black" fillOpacity="0.85"/>
                      </svg>
                    </button>
                    {/* 下载选项下拉菜单 */}
                    {showDownloadOptions && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        background: '#fff',
                        borderRadius: 8,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                        padding: 8,
                        marginTop: 4,
                        minWidth: 140,
                        zIndex: 10001
                      }}>
                        <button
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: 'none',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            borderRadius: 4,
                            fontSize: 14
                          }}
                          onClick={() => {
                            const all = [...history];
                            if (current) {
                              all.unshift({
                                name: current.name,
                                startAt: current.startAt,
                                endAt: now,
                                duration: now.getTime() - current.startAt.getTime(),
                                deleted: false
                              });
                            }
                            const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `activity-history-${new Date().toISOString().split('T')[0]}.json`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            setShowDownloadOptions(false);
                          }}
                        >
                          Export as JSON
                        </button>
                        <button
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: 'none',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            borderRadius: 4,
                            fontSize: 14
                          }}
                          onClick={() => {
                            const all = [...history];
                            if (current) {
                              all.unshift({
                                name: current.name,
                                startAt: current.startAt,
                                endAt: now,
                                duration: now.getTime() - current.startAt.getTime(),
                                deleted: false
                              });
                            }
                            const rows = all.map(item => {
                              const strike = item.deleted ? { font: { strike: true } } : {};
                              return {
                                Activity: Object.assign({ v: item.name }, strike),
                                Start: Object.assign({ v: item.startAt instanceof Date ? item.startAt.toISOString() : item.startAt }, strike),
                                End: Object.assign({ v: item.endAt instanceof Date ? item.endAt.toISOString() : item.endAt }, strike),
                                Duration: Object.assign({ v: formatHMS(Math.round(item.duration / 1000)) }, strike),
                                Seconds: Object.assign({ v: Math.round(item.duration / 1000) }, strike),
                                Deleted: item.deleted ? 'true' : 'false'
                              };
                            });
                            const ws = XLSX.utils.json_to_sheet(rows as any[]);
                            Object.keys(rows[0] || {}).forEach((col, colIdx) => {
                              (rows as any[]).forEach((row, rowIdx) => {
                                if (row[col] && row[col].font && ws[XLSX.utils.encode_cell({ r: rowIdx + 1, c: colIdx })]) {
                                  ws[XLSX.utils.encode_cell({ r: rowIdx + 1, c: colIdx })].s = row[col];
                                }
                              });
                            });
                            const wb = XLSX.utils.book_new();
                            XLSX.utils.book_append_sheet(wb, ws, 'History');
                            XLSX.writeFile(wb, `activity-history-${new Date().toISOString().split('T')[0]}.xlsx`);
                            setShowDownloadOptions(false);
                          }}
                        >
                          Export as Excel
                        </button>
                        <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
                        <button
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: 'none',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            borderRadius: 4,
                            fontSize: 14,
                            color: '#d70015'
                          }}
                          onClick={() => {
                            setShowClearModal(true);
                            setShowDownloadOptions(false);
                          }}
                        >
                          Clear All Data
                        </button>
                      </div>
                    )}
                  </div>
                  {/* 关闭按钮 */}
                  <button 
                    onClick={() => setShowStatsModal(false)}
                    style={{
                      width: 40,
                      height: 40,
                      background: '#f5f5f5',
                      border: 'none',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M14.158 5.27173L9.98804 9.44165L14.158 13.6116L13.3103 14.4592L9.14038 10.2893L4.97046 14.4592L4.1228 13.6116L8.29272 9.44165L4.1228 5.27173L4.97046 4.42407L9.14038 8.59399L13.3103 4.42407L14.158 5.27173Z" fill="black" fillOpacity="0.85"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* 筛选选项区 */}
              <div style={{ 
                padding: '16px max(12px, env(safe-area-inset-right)) 16px max(12px, env(safe-area-inset-left))',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                gap: 12,
                boxSizing: 'border-box'
              }}>
                {/* 时间选择下拉菜单 */}
                <div style={{ position: 'relative', flex: 1 }}>
                  <select
                    value={timeGranularity}
                    onChange={(e) => setTimeGranularity(e.target.value as 'Day' | 'Week' | 'Month' | 'Year')}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #e0e0e0',
                      borderRadius: 8,
                      background: '#fff',
                      fontSize: 14,
                      cursor: 'pointer'
                    }}
                  >
                    <option value="Day">Day</option>
                    <option value="Week">Week</option>
                    <option value="Month">Month</option>
                    <option value="Year">Year</option>
                  </select>
                </div>
                {/* 统计图类型选择下拉菜单 */}
                <div style={{ position: 'relative', flex: 1 }}>
                  <select
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value as 'Bar Chart' | 'Pie Chart')}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #e0e0e0',
                      borderRadius: 8,
                      background: '#fff',
                      fontSize: 14,
                      cursor: 'pointer'
                    }}
                  >
                    <option value="Bar Chart">Bar Chart</option>
                    <option value="Pie Chart">Pie Chart</option>
                  </select>
                </div>
              </div>

              {/* 内容区域 */}
              <div style={{ 
                flex: 1,
                overflowY: 'auto',
                padding: '16px max(12px, env(safe-area-inset-right)) 16px max(12px, env(safe-area-inset-left))',
                boxSizing: 'border-box',
                width: '100%'
              }}>
                {(() => {
                  const groupedData = groupDataByTimeGranularity(history, current, now, timeGranularity);
                  if (!groupedData.length) {
                    return <div style={{ color: '#888', textAlign: 'center', margin: '48px 0' }}>No activity data.</div>;
                  }

                  return groupedData.map((group, groupIndex) => {
                    const { timeKey, activities } = group;
                    const maxDuration = Math.max(...activities.map(a => a.duration));
                    
                    return (
                      <div key={timeKey} style={{ marginBottom: groupIndex < groupedData.length - 1 ? 24 : 0 }}>
                        <div style={{ 
                          fontWeight: 600, 
                          fontSize: 16, 
                          marginBottom: 12,
                          color: '#333'
                        }}>
                          {formatTimeKey(timeKey, timeGranularity)}
                        </div>
                        
                        {chartType === 'Bar Chart' ? (
                          // 条形图显示
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {activities.map(activity => (
                              <div key={activity.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ 
                                  flex: 1,
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: 14,
                                  fontWeight: 500,
                                  minWidth: 0
                                }}>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activity.name}</span>
                                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#666', flexShrink: 0 }}>
                                    {formatHMS(Math.round(activity.duration / 1000))}
                                  </span>
                                </div>
                                <div style={{ 
                                  background: getActivityColor(activity.name),
                                  height: 16,
                                  borderRadius: 4,
                                  width: `${Math.max(20, Math.min(80, (activity.duration / maxDuration) * 80))}px`,
                                  minWidth: 20,
                                  maxWidth: 80,
                                  flexShrink: 0
                                }} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          // 饼图显示
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* 饼图容器 */}
                            <div style={{ 
                              display: 'flex', 
                              justifyContent: 'center', 
                              marginBottom: 16 
                            }}>
                              <div style={{ 
                                position: 'relative',
                                width: 120,
                                height: 120
                              }}>
                                <svg width="120" height="120" viewBox="0 0 120 120">
                                  {(() => {
                                    const totalDuration = activities.reduce((sum, a) => sum + a.duration, 0);
                                    let currentAngle = 0;
                                    
                                    return activities.map((activity) => {
                                      const percentage = totalDuration > 0 ? activity.duration / totalDuration : 0;
                                      const angle = percentage * 360;
                                      const startAngle = currentAngle;
                                      const endAngle = currentAngle + angle;
                                      
                                      // 计算弧线路径
                                      const radius = 50;
                                      const centerX = 60;
                                      const centerY = 60;
                                      
                                      const startRad = (startAngle - 90) * Math.PI / 180;
                                      const endRad = (endAngle - 90) * Math.PI / 180;
                                      
                                      const x1 = centerX + radius * Math.cos(startRad);
                                      const y1 = centerY + radius * Math.sin(startRad);
                                      const x2 = centerX + radius * Math.cos(endRad);
                                      const y2 = centerY + radius * Math.sin(endRad);
                                      
                                      const largeArcFlag = angle > 180 ? 1 : 0;
                                      
                                      const pathData = [
                                        `M ${centerX} ${centerY}`,
                                        `L ${x1} ${y1}`,
                                        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                                        'Z'
                                      ].join(' ');
                                      
                                      currentAngle += angle;
                                      
                                      return (
                                        <path
                                          key={activity.name}
                                          d={pathData}
                                          fill={getActivityColor(activity.name)}
                                          stroke="#fff"
                                          strokeWidth="2"
                                        />
                                      );
                                    });
                                  })()}
                                </svg>
                              </div>
                            </div>
                            
                            {/* 图例 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {activities.map(activity => (
                                <div key={activity.name} style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: 12,
                                  padding: '8px 12px',
                                  background: '#f8f9fa',
                                  borderRadius: 8
                                }}>
                                  <div style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: '50%',
                                    background: getActivityColor(activity.name),
                                    flexShrink: 0
                                  }} />
                                  <div style={{ 
                                    flex: 1,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: 14,
                                    fontWeight: 500
                                  }}>
                                    <span>{activity.name}</span>
                                    <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#666' }}>
                                      {formatHMS(Math.round(activity.duration / 1000))}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* 清空数据确认弹窗 */}
            {showClearModal && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                background: 'rgba(0,0,0,0.18)',
                zIndex: 10002,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 24px',
                boxSizing: 'border-box',
              }}>
                <div
                  className="modal-content"
                  style={{
                    background: '#fff',
                    borderRadius: 16,
                    width: '100%',
                    maxWidth: 340,
                    margin: '0 auto',
                    padding: 28,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                    textAlign: 'center',
                    position: 'relative',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 18 }}>
                    Are you sure you want to clear all activity data?
                  </div>
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 24 }}>
                    <button
                      style={{
                        background: '#f5f5f5', color: '#333', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 16, cursor: 'pointer'
                      }}
                      onClick={() => setShowClearModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      style={{
                        background: '#d70015', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 16, cursor: 'pointer'
                      }}
                      onClick={() => {
                        localStorage.clear();
                        window.location.reload();
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {/* 结束当前活动提示弹窗 */}
        {showEndCurrentModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.18)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 24px',
            boxSizing: 'border-box',
          }}>
            <div
              className="modal-content"
              style={{
                background: '#fff',
                borderRadius: 16,
                width: '100%',
                maxWidth: 480,
                margin: '0 auto',
                padding: 28,
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                textAlign: 'center',
                position: 'relative',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 18 }}>
                There is an ongoing activity. Do you want to stop it and continue?
              </div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 24 }}>
                <button
                  style={{
                    background: '#f5f5f5', color: '#333', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 16, cursor: 'pointer'
                  }}
                  onClick={() => setShowEndCurrentModal(false)}
                >
                  Back
                </button>
                <button
                  style={{
                    background: '#00313c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 16, cursor: 'pointer'
                  }}
                  onClick={() => {
                    setShowEndCurrentModal(false);
                    stopCurrent();
                    setTimeout(() => setShowStatsModal(true), 200);
                  }}
                >
                  Stop and Download
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 刷新拦截弹窗 */}
        {showRefreshModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.18)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 24px',
            boxSizing: 'border-box',
          }}>
            <div
              className="modal-content"
              style={{
                background: '#fff',
                borderRadius: 16,
                width: '100%',
                maxWidth: 480,
                margin: '0 auto',
                padding: 28,
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                textAlign: 'center',
                position: 'relative',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 18 }}>
                There is an ongoing activity. Do you want to refresh?
              </div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 24 }}>
                <button
                  style={{
                    background: '#f5f5f5', color: '#333', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 16, cursor: 'pointer'
                  }}
                  onClick={() => {
                    setShowRefreshModal(false);
                
                  }}
                >
                  Cancel
                </button>
                <button
                  style={{
                    background: '#00313c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 16, cursor: 'pointer'
                  }}
                  onClick={() => {
                    stopCurrent();
                    setShowRefreshModal(false);
                   
                    window.location.reload();
                  }}
                >
                  Stop and Refresh
                </button>
              </div>
            </div>
          </div>
        )}
        <div
          className="activity-main"
          ref={mainRef}
          onScroll={handleScroll}
          onClick={e => {
            // 如果点击的是卡片内的按钮，不处理
            if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
            setSwipeDelete(null);
          }}
        >
          {/* 日期时间区块 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            borderRadius: 16,
            marginBottom: 16,
            marginTop: 38,
            width: '100%',
            paddingLeft: 0,
            marginLeft: 0
          }}>
            <div style={{ textAlign: 'left', flex: 1, paddingLeft: 0, marginLeft: 0 }}>
              <div style={{
                color: '#000，',
                fontSize: 16,
                fontStyle: 'normal',
                fontWeight: 700,
                lineHeight: 'normal',
                textTransform: 'capitalize',
              }}>
                {isToday(now) ? 'Today' : formatHeaderDate(now)}
              </div>
            </div>
          </div>
          {/* 当前活动卡片 */}
          {current && (
            <div className="activity-card-now">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div className="activity-card-title">Now</div>
                  {/* 当前活动卡片名称可编辑 */}
                  {editingCurrentName ? (
                    <input
                      style={{ fontSize: 24, fontWeight: 600, width: '100%', marginBottom: 8 }}
                      value={editingName}
                      autoFocus
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={() => {
                        if (editingName.trim() === '') {
                          setEditingName(current.name); // 恢复原标题
                          setEditingCurrentName(false);
                        } else {
                          setCurrent({ ...current, name: editingName });
                          setEditingCurrentName(false);
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (editingName.trim() === '') {
                            setEditingName(current.name); // 恢复原标题
                            setEditingCurrentName(false);
                          } else {
                            setCurrent({ ...current, name: editingName });
                            setEditingCurrentName(false);
                          }
                        }
                      }}
                    />
                  ) : (
                    <div className="activity-card-title" style={{ fontSize: 24, cursor: 'pointer' }} onClick={() => { setEditingCurrentName(true); setEditingName(current.name); }}>{current.name}</div>
                  )}
                  <div className="activity-card-label">Start At: {formatTime(current.startAt)}</div>
                  <div className="activity-card-label">Duration: {formatDuration(now.getTime() - current.startAt.getTime())}</div>
                  <div className="activity-card-label">End At: -</div>
                </div>
                <Button 
                  color="danger" 
                  shape="rounded" 
                  size="mini" 
                  style={{ 
                    marginTop: 0, 
                    alignSelf: 'flex-end',
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    border: '1px solid #ccc'
                  }} 
                  onClick={stopCurrent}
                >
                  <div style={{
                    width: '18px',
                    height: '18px',
                    backgroundColor: '#D70015',
                    borderRadius: '2px'
                  }}></div>
                </Button>
              </div>
            </div>
          )}
          {/* 今天的活动卡片流 */}
          {todaysActivities.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {todaysActivities.map((item, idx) => {
                const isShowDelete = swipeDelete && swipeDelete.idx === idx && swipeDelete.date === 'today';
                const isDeleted = item.deleted;
                return (
                  <div
                    className="activity-card-history"
                    key={idx}
                    style={{ position: 'relative', overflow: 'hidden', opacity: isDeleted ? 0.6 : 1, userSelect: 'none', touchAction: 'manipulation' }}
                    onTouchStart={() => {
                      longPressTimer = setTimeout(() => setSwipeDelete({ date: 'today', idx }), 600);
                    }}
                    onTouchEnd={() => {
                      clearTimeout(longPressTimer);
                    }}
                    onMouseDown={() => {
                      longPressTimer = setTimeout(() => setSwipeDelete({ date: 'today', idx }), 600);
                    }}
                    onMouseUp={() => {
                      clearTimeout(longPressTimer);
                    }}
                  >
                    {/* delete/recover 按钮 */}
                    {isShowDelete && !isDeleted && (
                      <button
                        style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, background: '#d70015', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                        onClick={() => {
                          const newHistory = [...history];
                          const todayIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                          if (todayIdx !== -1) newHistory[todayIdx].deleted = true;
                          setHistory(newHistory);
                          setSwipeDelete(null);
                        }}
                      >delete</button>
                    )}
                    {isShowDelete && isDeleted && (
                      <button
                        style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, background: '#00b96b', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                        onClick={() => {
                          const newHistory = [...history];
                          const todayIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                          if (todayIdx !== -1) newHistory[todayIdx].deleted = false;
                          setHistory(newHistory);
                          setSwipeDelete(null);
                        }}
                      >recover</button>
                    )}
                    {editingHistory && editingHistory.idx === idx && editingHistory.date === 'today' ? (
                      <input
                        style={{ fontSize: 16, fontWeight: 600, width: '100%', marginBottom: 6 }}
                        value={editingName}
                        autoFocus
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => {
                          const newHistory = [...history];
                          const todayIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                          if (todayIdx !== -1) {
                            if (editingName.trim() === '') {
                              setEditingName(history[todayIdx].name); // 恢复原标题
                            } else {
                              newHistory[todayIdx].name = editingName;
                              setHistory(newHistory);
                            }
                          }
                          setEditingHistory(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const newHistory = [...history];
                            const todayIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                            if (todayIdx !== -1) {
                              if (editingName.trim() === '') {
                                setEditingName(history[todayIdx].name); // 恢复原标题
                              } else {
                                newHistory[todayIdx].name = editingName;
                                setHistory(newHistory);
                              }
                            }
                            setEditingHistory(null);
                          }
                        }}
                      />
                    ) : (
                      <div className="activity-card-title" style={{ cursor: 'pointer', textDecoration: isDeleted ? 'line-through' : undefined }} onClick={() => { setEditingHistory({ date: 'today', idx }); setEditingName(item.name); }}>{item.name}</div>
                    )}
                    <div className="activity-card-row">
                      <span className="activity-card-label" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>Start At:</span>
                      <span className="activity-card-value" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>{formatStartAt(item.startAt, item.endAt)}</span>
                    </div>
                    <div className="activity-card-row">
                      <span className="activity-card-label" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>End At:</span>
                      <span className="activity-card-value" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>{formatTime(item.endAt)}</span>
                    </div>
                    <div className="activity-card-row">
                      <span className="activity-card-label" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>Duration:</span>
                      <span className="activity-card-value" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>{formatDuration(item.duration)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* 历史活动分组卡片 */}
          <div style={{ marginBottom: 16 }}>
            {displayHistory.map(([date, items]: [string, any[]]) => (
              <div key={date}>
                <div style={{ fontWeight: 700, fontSize: 16, margin: '18px 0 8px 0' }}>{formatHeaderDateStr(date)}</div>
                {items.length === 0 && (
                  <div style={{ color: '#bbb', fontSize: 14, marginBottom: 12 }}>No activity</div>
                )}
                {items.slice(0, 3).map((item, idx) => {
                  const isShowDelete = swipeDelete && swipeDelete.idx === idx && swipeDelete.date === date;
                  const isDeleted = item.deleted;
                  return (
                    <div
                      className="activity-card-history"
                      key={idx}
                      style={{ position: 'relative', overflow: 'hidden', opacity: isDeleted ? 0.6 : 1, userSelect: 'none', touchAction: 'manipulation' }}
                      onTouchStart={() => {
                        longPressTimer = setTimeout(() => setSwipeDelete({ date, idx }), 600);
                      }}
                      onTouchEnd={() => {
                        clearTimeout(longPressTimer);
                      }}
                      onMouseDown={() => {
                        longPressTimer = setTimeout(() => setSwipeDelete({ date, idx }), 600);
                      }}
                      onMouseUp={() => {
                        clearTimeout(longPressTimer);
                      }}
                    >
                      {/* delete/recover 按钮 */}
                      {isShowDelete && !isDeleted && (
                        <button
                          style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, background: '#d70015', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                          onClick={() => {
                            const newHistory = [...history];
                            const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                            if (histIdx !== -1) newHistory[histIdx].deleted = true;
                            setHistory(newHistory);
                            setSwipeDelete(null);
                          }}
                        >delete</button>
                      )}
                      {isShowDelete && isDeleted && (
                        <button
                          style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, background: '#00b96b', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                          onClick={() => {
                            const newHistory = [...history];
                            const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                            if (histIdx !== -1) newHistory[histIdx].deleted = false;
                            setHistory(newHistory);
                            setSwipeDelete(null);
                          }}
                        >recover</button>
                      )}
                      {editingHistory && editingHistory.idx === idx && editingHistory.date === date ? (
                        <input
                          style={{ fontSize: 16, fontWeight: 600, width: '100%', marginBottom: 6 }}
                          value={editingName}
                          autoFocus
                          onChange={e => setEditingName(e.target.value)}
                          onBlur={() => {
                            const newHistory = [...history];
                            const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                            if (histIdx !== -1) {
                              if (editingName.trim() === '') {
                                setEditingName(history[histIdx].name); // 恢复原标题
                              } else {
                                newHistory[histIdx].name = editingName;
                                setHistory(newHistory);
                              }
                            }
                            setEditingHistory(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const newHistory = [...history];
                              const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                              if (histIdx !== -1) {
                                if (editingName.trim() === '') {
                                  setEditingName(history[histIdx].name); // 恢复原标题
                                } else {
                                  newHistory[histIdx].name = editingName;
                                  setHistory(newHistory);
                                }
                              }
                              setEditingHistory(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="activity-card-title" style={{ cursor: 'pointer', textDecoration: isDeleted ? 'line-through' : undefined }} onClick={() => { setEditingHistory({ date, idx }); setEditingName(item.name); }}>{item.name}</div>
                      )}
                      <div className="activity-card-row">
                        <span className="activity-card-label" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>Start At:</span>
                        <span className="activity-card-value" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>{formatStartAt(item.startAt, item.endAt)}</span>
                      </div>
                      <div className="activity-card-row">
                        <span className="activity-card-label" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>End At:</span>
                        <span className="activity-card-value" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>{formatTime(item.endAt)}</span>
                      </div>
                      <div className="activity-card-row">
                        <span className="activity-card-label" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>Duration:</span>
                        <span className="activity-card-value" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>{formatDuration(item.duration)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 底部固定活动选择与输入区 */}
      {showBottomSheet && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 199,
              background: 'rgba(0,0,0,0)', // 可根据需要加深遮罩色
            }}
            onClick={() => setShowBottomSheet(false)}
            onTouchStart={() => setShowBottomSheet(false)}
          />
          <div className="activity-bottom-sheet-fixed" style={{ zIndex: 200, position: 'fixed', left: '50%', bottom: 0, transform: 'translateX(-50%)' }}>
            <div className="activity-popup-inner" style={{ padding: '0 24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
              {/* 可滚动的tag区域 */}
              <div style={{ 
                flex: 1,
                overflowY: 'auto',
                paddingRight: '8px'
              }}>
                {/* Recent Activities */}
                {recentActivities.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ 
                      fontSize: 12, 
                      fontWeight: 600, 
                      color: '#666', 
                      marginBottom: 12,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5
                    }}>
                      Recent
                    </div>
                    <Grid columns={2} gap={12} className="activity-btn-grid">
                      {recentActivities.map(activity => (
                        <Grid.Item key={activity}>
                          <Button 
                            block 
                            className="activity-btn" 
                            shape="rounded" 
                            size="large" 
                            onClick={() => startActivity(activity)}
                          >
                            {activity}
                          </Button>
                        </Grid.Item>
                      ))}
                    </Grid>
                  </div>
                )}
                
                {/* ADLs Activities */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ 
                    fontSize: 12, 
                    fontWeight: 600, 
                    color: '#666', 
                    marginBottom: 12,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5
                  }}>
                    ADLs
                  </div>
                  <Grid columns={2} gap={12} className="activity-btn-grid">
                    {activityTypes.map(type => (
                      <Grid.Item key={type}>
                        <Button block className="activity-btn" shape="rounded" size="large" onClick={() => startActivity(type)}>{type}</Button>
                      </Grid.Item>
                    ))}
                  </Grid>
                </div>
              </div>
              
              {/* 固定在底部的输入框 */}
              <div className="activity-input-row-inner" style={{ 
                marginTop: 16,
                flexShrink: 0,
                paddingTop: 16,
                borderTop: '1px solid #f0f0f0'
              }}>
                <Input
                  className="activity-input"
                  placeholder="Write Activity Name"
                  value={activityName}
                  onChange={val => setActivityName(val)}
                  clearable
                  style={{ flex: 1 }}
                />
                <Button className="activity-btn ant-btn-primary" shape="rounded" onClick={() => startActivity(activityName)} disabled={!activityName}>Start</Button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* 底部固定活动选择与输入区 */}
      {!showBottomSheet && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: 0,
          transform: 'translateX(-50%)',
          width: 'calc(100vw - 48px)',
          maxWidth: 420,
          background: '#e9f2f4',
          zIndex: 399,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <button
            className="activity-bottom-sheet-toggle-btn"
            style={{
              position: 'relative',
              marginBottom: 16,
              background: '#00313c',
              color: '#fff',
              border: 'none',
              borderRadius: 24,
              padding: '12px 32px',
              fontSize: 18,
              fontWeight: 600,
              boxShadow: '0px 91px 25px 0px rgba(0, 0, 0, 0.00), 0px 58px 23px 0px rgba(0, 0, 0, 0.01), 0px 33px 20px 0px rgba(0, 0, 0, 0.05), 0px 14px 14px 0px rgba(0, 0, 0, 0.09), 0px 4px 8px 0px rgba(0, 0, 0, 0.10)',
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
            onClick={() => setShowBottomSheet(true)}
          >
            + Start Activity
        </button>
        </div>
      )}
      </div>
  );
}

export default App;
