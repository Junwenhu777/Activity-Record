import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, Grid } from 'antd-mobile';
import './App.css';
import * as XLSX from 'xlsx';

// 测试 XLSX 库是否正确加载
console.log('XLSX library loaded:', typeof XLSX);
console.log('XLSX.utils available:', !!XLSX.utils);
console.log('XLSX.write available:', !!XLSX.write);

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
  const [isBottomSheetClosing, setIsBottomSheetClosing] = useState(false);
  const [recentActivities, setRecentActivities] = useState<string[]>(() => {
    const r = localStorage.getItem('activity-recent');
    return r ? JSON.parse(r) : [];
  });
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [isStatsModalClosing, setIsStatsModalClosing] = useState(false);
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
  // 新增state用于编辑recent activity
  const [editingRecentActivity, setEditingRecentActivity] = useState<string | null>(null);
  const [editingRecentName, setEditingRecentName] = useState('');

  // 新增 Summary popup 相关状态
  const [showDownloadOptions, setShowDownloadOptions] = useState(false);
  const [isDownloadOptionsClosing, setIsDownloadOptionsClosing] = useState(false);
  const [timeGranularity, setTimeGranularity] = useState<'Day' | 'Week' | 'Month' | 'Year'>('Day');
  const [chartType, setChartType] = useState<'Bar Chart' | 'Pie Chart'>('Bar Chart');
  const [showActivityFilter, setShowActivityFilter] = useState(false);
  const [isActivityFilterClosing, setIsActivityFilterClosing] = useState(false);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [showStartButton, setShowStartButton] = useState(false);
  const [popupRendered, setPopupRendered] = useState(true);

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
    const handleClickOutside = (e: MouseEvent) => {
      // 检查是否点击了下载选项下拉菜单
      if (showDownloadOptions) {
        const target = e.target as Element;
        const downloadButton = document.querySelector('[data-download-button]');
        const downloadOptions = document.querySelector('[data-download-options]');
        
        if (downloadButton && !downloadButton.contains(target) && 
            downloadOptions && !downloadOptions.contains(target)) {
          setIsDownloadOptionsClosing(true);
          setTimeout(() => {
            setShowDownloadOptions(false);
            setIsDownloadOptionsClosing(false);
          }, 300);
        }
      }
      
      // 检查是否点击了活动筛选下拉菜单
      if (showActivityFilter) {
        const target = e.target as Element;
        const activityFilterButton = document.querySelector('[data-activity-filter-button]');
        const activityFilterOptions = document.querySelector('[data-activity-filter-options]');
        
        if (activityFilterButton && !activityFilterButton.contains(target) && 
            activityFilterOptions && !activityFilterOptions.contains(target)) {
          setShowActivityFilter(false);
        }
      }
      
      // 检查是否点击了 popup 外部区域
      if (showStatsModal && !isStatsModalClosing) {
        const target = e.target as Element;
        const popupContent = document.querySelector('.summary-popup-content');
        const popupOuter = document.querySelector('.summary-popup-outer');
        
        if (popupOuter && popupOuter.contains(target) && 
            popupContent && !popupContent.contains(target)) {
          // 点击了 popup 外部区域，开始关闭动画
          // 防止重复触发
          if (!isStatsModalClosing) {
            // 使用 requestAnimationFrame 确保在下一帧执行，避免 Safari 闪动
                          requestAnimationFrame(() => {
                setIsStatsModalClosing(true);
                // 先等待动画完成，再隐藏元素
                setTimeout(() => {
                  setShowStatsModal(false);
                  // 确保元素完全隐藏后再重置状态
                  setTimeout(() => {
                    setIsStatsModalClosing(false);
                  }, 100);
                }, 400);
              });
          }
        }
      }
    };

    if (showDownloadOptions || showActivityFilter || showStatsModal) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDownloadOptions, showActivityFilter, showStatsModal, isStatsModalClosing]);

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
    const newHistoryItem = { name: current.name, startAt: current.startAt, endAt, duration, deleted: false };
    setHistory(prevHistory => [newHistoryItem, ...prevHistory]);
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
      // 滚动整个页面到顶部
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      
      // 如果mainRef存在，也尝试滚动它
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
    }, 200);
  };



  // 移动端触摸滚动监听
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    // 移动端触摸滚动时也收起popup，使用节流处理
    throttledScrollHandler(e as any);
  };

  // 节流函数
  const throttle = (func: Function, delay: number) => {
    let timeoutId: number;
    let lastExecTime = 0;
    return function (...args: any[]) {
      const currentTime = Date.now();
      if (currentTime - lastExecTime > delay) {
        func.apply(null, args);
        lastExecTime = currentTime;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(null, args);
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  };

  // 节流后的滚动处理函数
  const throttledScrollHandler = throttle((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    console.log('Scroll event triggered, scrollTop:', scrollTop, 'popupRendered:', popupRendered, 'isBottomSheetClosing:', isBottomSheetClosing);
    
    // 任何滚动都收起popup并显示start按钮
    if (popupRendered && !isBottomSheetClosing) {
      console.log('Closing popup due to scroll');
      setIsBottomSheetClosing(true);
      setShowStartButton(false);
      setTimeout(() => {
        setShowBottomSheet(false);
        // 立即重置关闭状态，确保popup从DOM中移除
        setIsBottomSheetClosing(false);
        // 立即从DOM中移除popup
        setPopupRendered(false);
        // 延迟显示start按钮，确保popup完全消失
        setTimeout(() => {
          setShowStartButton(true);
        }, 100);
      }, 450);
    }
    
    lastScrollTop.current = scrollTop;
  }, 50); // 减少到50ms节流，更敏感

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

  // 全局滚动监听，当popup显示时，只有主页面的滚动才关闭popup
  useEffect(() => {
    if (!popupRendered || isBottomSheetClosing) return;
    
    const handleGlobalScroll = (e: Event) => {
      // 检查滚动事件是否来自popup内部
      const target = e.target as Element;
      const popupContent = document.querySelector('.summary-popup-content');
      const popupOuter = document.querySelector('.summary-popup-outer');
      const activityPopupInner = document.querySelector('.activity-popup-inner');
      
      // 如果滚动事件来自popup内部，则不关闭popup
      if (popupContent && (popupContent.contains(target) || popupContent === target)) {
        console.log('Scroll event from popup content, ignoring');
        return;
      }
      if (popupOuter && (popupOuter.contains(target) || popupOuter === target)) {
        console.log('Scroll event from popup outer, ignoring');
        return;
      }
      if (activityPopupInner && (activityPopupInner.contains(target) || activityPopupInner === target)) {
        console.log('Scroll event from activity popup inner, ignoring');
        return;
      }
      
      console.log('Global scroll event triggered from main page');
      if (!isBottomSheetClosing) {
        setIsBottomSheetClosing(true);
        setShowStartButton(false);
        setTimeout(() => {
          setShowBottomSheet(false);
          setIsBottomSheetClosing(false);
          setPopupRendered(false);
          setTimeout(() => {
            setShowStartButton(true);
          }, 100);
        }, 450);
      }
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      // 检查触摸事件是否来自popup内部
      const target = e.target as Element;
      const popupContent = document.querySelector('.summary-popup-content');
      const popupOuter = document.querySelector('.summary-popup-outer');
      const activityPopupInner = document.querySelector('.activity-popup-inner');
      
      // 如果触摸事件来自popup内部，则不关闭popup
      if (popupContent && (popupContent.contains(target) || popupContent === target)) {
        console.log('Touch move event from popup content, ignoring');
        return;
      }
      if (popupOuter && (popupOuter.contains(target) || popupOuter === target)) {
        console.log('Touch move event from popup outer, ignoring');
        return;
      }
      if (activityPopupInner && (activityPopupInner.contains(target) || activityPopupInner === target)) {
        console.log('Touch move event from activity popup inner, ignoring');
        return;
      }
      
      console.log('Global touch move event triggered from main page');
      if (!isBottomSheetClosing) {
        setIsBottomSheetClosing(true);
        setShowStartButton(false);
        setTimeout(() => {
          setShowBottomSheet(false);
          setIsBottomSheetClosing(false);
          setPopupRendered(false);
          setTimeout(() => {
            setShowStartButton(true);
          }, 100);
        }, 450);
      }
    };

    // 监听window的滚动和触摸事件
    window.addEventListener('scroll', handleGlobalScroll, { passive: false });
    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    
    return () => {
      window.removeEventListener('scroll', handleGlobalScroll);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
    };
  }, [popupRendered, isBottomSheetClosing]);

  // 获取所有可用活动列表
  const getAllActivities = () => {
    const activities = new Set<string>();
    
    // 添加历史活动
    history.forEach(item => {
      if (!item.deleted) {
        activities.add(item.name);
      }
    });
    
    // 添加当前活动
    if (current) {
      activities.add(current.name);
    }
    
    // 添加预设活动类型
    activityTypes.forEach(type => activities.add(type));
    
    return Array.from(activities).sort();
  };

  // 活动筛选逻辑
  const getFilteredData = (data: any[]) => {
    if (selectedActivities.length === 0) {
      return data; // 如果没有选择任何活动，显示所有活动
    }
    
    return data.map(group => ({
      ...group,
      activities: group.activities.filter((activity: any) => 
        selectedActivities.includes(activity.name)
      )
    })).filter(group => group.activities.length > 0);
  };

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
            paddingLeft: 0, // 移除左侧内边距，让CSS控制
            paddingRight: 0, // 确保右侧也没有内边距
          }}>
            <div 
              className="activity-title" 
              style={{ 
                textAlign: 'left',
                cursor: 'pointer',
                userSelect: 'none'
              }}
              onClick={() => {
                // 滚动到主内容区顶部
                if (mainRef.current) {
                  mainRef.current.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                  });
                }
                // 同时滚动整个页面到顶部
                window.scrollTo({
                  top: 0,
                  behavior: 'smooth'
                });
              }}
            >
              🐱 Activity Records
            </div>
            <button 
              onClick={handleDownloadClick}
              style={{
                width: 36, 
                height: 36, 
                borderRadius: '50%', 
                border: 'none',
                background: 'rgba(110, 176, 188, 0.2)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer',
                padding: 0
              }}
            >
              <svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15.0806 9.7376C15.697 9.09724 16.0414 8.24295 16.0414 7.3541C16.0414 6.46524 15.697 5.61095 15.0806 4.9706C14.7801 4.65842 14.4197 4.41008 14.021 4.24046C13.6222 4.07083 13.1934 3.9834 12.7601 3.9834C12.3268 3.9834 11.8979 4.07083 11.4992 4.24046C11.1005 4.41008 10.7401 4.65842 10.4396 4.9706L9.50245 5.98385L8.51808 4.97256C8.21758 4.66039 7.85718 4.41205 7.45846 4.24242C7.05973 4.0728 6.63088 3.98537 6.19758 3.98537C5.76427 3.98537 5.33542 4.0728 4.9367 4.24242C4.53797 4.41205 4.17758 4.66039 3.87708 4.97256C3.26063 5.61292 2.91626 6.46721 2.91626 7.35606C2.91626 8.24492 3.26063 9.09921 3.87708 9.73956L9.4552 15.4693L15.0806 9.7376Z" fill="#003746"/>
              </svg>
            </button>
          </div>
        </div>
        {/* Summary Popup 窗口 */}
        {(showStatsModal || isStatsModalClosing) && (
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
            animation: isStatsModalClosing 
              ? 'fadeOut 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' 
              : 'fadeIn 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
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
                overflow: 'hidden',
                animation: isStatsModalClosing 
                  ? 'slideDown 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' 
                  : 'slideUp 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
              }}
            >
              {/* 标题区 */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                width: '100%', 
                padding: '24px 24px 16px 24px',
                boxSizing: 'border-box'
              }}>
                <div style={{ fontWeight: 700, fontSize: 20, color: '#222' }}>Summary</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* 下载按钮 */}
                  <div style={{ position: 'relative' }}>
                    <button 
                      data-download-button
                      onClick={() => {
                                              console.log('Download button clicked, current state:', showDownloadOptions);
                      if (showDownloadOptions) {
                        setIsDownloadOptionsClosing(true);
                        setTimeout(() => {
                          setShowDownloadOptions(false);
                          setIsDownloadOptionsClosing(false);
                        }, 300);
                      } else {
                        setShowDownloadOptions(true);
                      }
                      }}
                      style={{
                        width: 38,
                        height: 38,
                        background: '#E9F2F4',
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        position: 'relative'
                      }}
                    >
                      {/* 选中态蒙层 */}
                      {showDownloadOptions && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            borderRadius: '50%',
                            background: 'rgba(0, 146, 189, 0.2)',
                            pointerEvents: 'none'
                          }}
                        />
                      )}
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M15.5625 16.1953H2.4375V14.9961H15.5625V16.1953ZM9.59961 10.8672L12.5137 7.95312L13.3613 8.80078L9.42383 12.7383C9.18952 12.9726 8.81048 12.9726 8.57617 12.7383L4.63867 8.80078L5.48633 7.95312L8.40039 10.8672V1.81445H9.59961V10.8672Z" fill="black" fillOpacity="0.85"/>
                      </svg>
                    </button>
                    {/* 下载选项下拉菜单 */}
                    {(showDownloadOptions || isDownloadOptionsClosing) && (
                      <div 
                        data-download-options
                        style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        background: '#fff',
                        borderRadius: 8,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                        padding: 8,
                        marginTop: 4,
                        minWidth: 140,
                        zIndex: 100001,
                        animation: isDownloadOptionsClosing 
                          ? 'downloadMenuSlideUp 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards'
                          : 'downloadMenuSlideDown 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                        transformOrigin: 'top right',
                        willChange: 'transform, opacity'
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
                            fontSize: 14,
                            position: 'relative',
                            zIndex: 10002,
                            userSelect: 'none',
                            WebkitUserSelect: 'none'
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('Button mouse down!');
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('Button clicked!'); // 简单测试
                            try {
                              console.log('=== Excel Export Debug ===');
                              console.log('XLSX library:', typeof XLSX);
                              console.log('XLSX.utils:', XLSX.utils);
                              console.log('XLSX.write:', XLSX.write);
                              
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
                              console.log('Data prepared:', all.length, 'items');
                              console.log('Sample data:', all[0]);
                              
                              // 简化的数据格式
                              const rows = all.map(item => ({
                                Activity: item.name,
                                Start: item.startAt instanceof Date ? item.startAt.toISOString() : item.startAt,
                                End: item.endAt instanceof Date ? item.endAt.toISOString() : item.endAt,
                                Duration: formatHMS(Math.round(item.duration / 1000)),
                                Seconds: Math.round(item.duration / 1000),
                                Deleted: item.deleted ? 'true' : 'false'
                              }));
                              
                              console.log('Creating worksheet...');
                              const ws = XLSX.utils.json_to_sheet(rows);
                              console.log('Worksheet created:', ws);
                              
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, 'History');
                              console.log('Workbook created:', wb);
                              
                              console.log('Writing file...');
                              const fileName = `activity-history-${new Date().toISOString().split('T')[0]}.xlsx`;
                              
                              // 使用 Blob 方法，兼容性更好
                              const blob = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                              console.log('Blob created:', blob);
                              console.log('Blob size:', blob.length);
                              
                              const url = URL.createObjectURL(new Blob([blob], { 
                                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
                              }));
                              console.log('URL created:', url);
                              
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = fileName;
                              console.log('Download link created:', a);
                              
                              document.body.appendChild(a);
                              console.log('Link appended to body');
                              
                              a.click();
                              console.log('Click triggered');
                              
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                              
                              console.log('Export completed successfully');
                              setIsDownloadOptionsClosing(true);
                              setTimeout(() => {
                                setShowDownloadOptions(false);
                                setIsDownloadOptionsClosing(false);
                              }, 300);
                            } catch (error) {
                              console.error('Export failed:', error);
                              console.error('Error stack:', (error as Error).stack);
                              alert('Export failed: ' + (error as Error).message);
                            }
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
                            setIsDownloadOptionsClosing(true);
                            setTimeout(() => {
                              setShowDownloadOptions(false);
                              setIsDownloadOptionsClosing(false);
                            }, 300);
                          }}
                        >
                          Clear All Data
                        </button>
                      </div>
                    )}
                  </div>
                  {/* 关闭按钮 */}
                  <button 
                    onClick={() => {
                      // 使用 requestAnimationFrame 确保在下一帧执行，避免 Safari 闪动
                      requestAnimationFrame(() => {
                        setIsStatsModalClosing(true);
                        // 使用更长的延迟确保动画完成
                        setTimeout(() => {
                          setShowStatsModal(false);
                          // 额外延迟重置状态，确保动画完全结束
                          setTimeout(() => {
                            setIsStatsModalClosing(false);
                          }, 50);
                        }, 300);
                      });
                    }}
                    style={{
                      width: 38,
                      height: 38,
                      background: '#E9F2F4',
                      border: 'none',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0
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
                padding: '16px 24px',
                display: 'flex',
                gap: 10,
                boxSizing: 'border-box',
                overflowX: 'hidden',
                overflowY: 'visible'
              }}>
                {/* 时间选择下拉菜单 */}
                <div style={{ position: 'relative', width: 'fit-content' }}>
                  <div
                    style={{
                      display: 'flex',
                      height: 38,
                      padding: '10px 14px',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 10,
                      borderRadius: 200,
                      border: 'none',
                      background: '#E9F2F4',
                      cursor: 'pointer',
                      boxSizing: 'border-box'
                    }}
                    onClick={() => {
                      // 这里可以添加下拉菜单的展开逻辑
                    }}
                  >
                    <span style={{
                      color: '#000',
                      fontSize: 12,
                      fontStyle: 'normal',
                      fontWeight: 700,
                      lineHeight: 'normal',
                      textTransform: 'capitalize',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {timeGranularity}
                    </span>
                    <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4.81921 7.20288L9.41296 11.7966L14.0067 7.20288" stroke="black" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  {/* 隐藏的原生 select 用于数据绑定 */}
                  <select
                    value={timeGranularity}
                    onChange={(e) => setTimeGranularity(e.target.value as 'Day' | 'Week' | 'Month' | 'Year')}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
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
                <div style={{ position: 'relative', width: 'fit-content' }}>
                  <div
                    style={{
                      display: 'flex',
                      height: 38,
                      padding: '10px 14px',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 10,
                      borderRadius: 200,
                      border: 'none',
                      background: '#E9F2F4',
                      cursor: 'pointer',
                      boxSizing: 'border-box'
                    }}
                    onClick={() => {
                      // 这里可以添加下拉菜单的展开逻辑
                    }}
                  >
                    <span style={{
                      color: '#000',
                      fontSize: 12,
                      fontStyle: 'normal',
                      fontWeight: 700,
                      lineHeight: 'normal',
                      textTransform: 'capitalize',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {chartType}
                    </span>
                    <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4.81921 7.20288L9.41296 11.7966L14.0067 7.20288" stroke="black" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  {/* 隐藏的原生 select 用于数据绑定 */}
                  <select
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value as 'Bar Chart' | 'Pie Chart')}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer'
                    }}
                  >
                    <option value="Bar Chart">Bar Chart</option>
                    <option value="Pie Chart">Pie Chart</option>
                  </select>
                </div>
                {/* 活动筛选下拉菜单 */}
                <div style={{ position: 'relative', width: 'fit-content', zIndex: 999999 }}>
                  <div
                    data-activity-filter-button
                    style={{
                      display: 'flex',
                      height: 38,
                      padding: '10px 14px',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 10,
                      borderRadius: 200,
                      border: 'none',
                      background: '#E9F2F4',
                      cursor: 'pointer',
                      boxSizing: 'border-box'
                    }}
                    onClick={() => {
                      if (showActivityFilter) {
                        setIsActivityFilterClosing(true);
                        setTimeout(() => {
                          setShowActivityFilter(false);
                          setIsActivityFilterClosing(false);
                        }, 300);
                      } else {
                        setShowActivityFilter(true);
                      }
                    }}
                  >
                    <span style={{
                      color: '#000',
                      fontSize: 12,
                      fontStyle: 'normal',
                      fontWeight: 700,
                      lineHeight: 'normal',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {selectedActivities.length === 0 ? 'All' : `${selectedActivities.length} Selected`}
                    </span>
                    <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4.81921 7.20288L9.41296 11.7966L14.0067 7.20288" stroke="black" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </div>

                  {/* 活动筛选下拉菜单 - 使用Portal渲染到body顶层 */}
                  {(showActivityFilter || isActivityFilterClosing) && createPortal(
                    <div 
                      data-activity-filter-options
                      style={{
                        position: 'fixed',
                        top: (() => {
                          const button = document.querySelector('[data-activity-filter-button]');
                          if (button) {
                            const rect = button.getBoundingClientRect();
                            return rect.bottom + 4;
                          }
                          return '50%';
                        })(),
                        left: (() => {
                          const button = document.querySelector('[data-activity-filter-button]');
                          if (button) {
                            const rect = button.getBoundingClientRect();
                            const menuWidth = 200; // 菜单的最小宽度
                            const screenWidth = window.innerWidth;
                            const rightEdge = rect.left + menuWidth;
                            
                            // 如果菜单会溢出右边，则向左调整
                            if (rightEdge > screenWidth - 20) {
                              return Math.max(20, screenWidth - menuWidth - 20);
                            }
                            return rect.left;
                          }
                          return '50%';
                        })(),
                        background: '#fff',
                        borderRadius: 8,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                        padding: 8,
                        minWidth: 200,
                        maxHeight: 350,
                        overflowY: 'auto',
                        zIndex: 999999,
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                        animation: isActivityFilterClosing 
                          ? 'slideUpAndFadeOut 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' 
                          : 'slideDownAndFadeIn 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                        pointerEvents: 'auto'
                      }}>
                  {/* All 选项 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderRadius: 4,
                      fontSize: 14,
                      background: selectedActivities.length === 0 ? '#f0f0f0' : 'transparent'
                    }}
                    onClick={() => {
                      setSelectedActivities([]);
                      setShowActivityFilter(false);
                    }}
                  >
                    <div style={{
                      width: 16,
                      height: 16,
                      border: '2px solid #ddd',
                      borderRadius: 3,
                      marginRight: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: selectedActivities.length === 0 ? '#007bff' : 'transparent'
                    }}>
                      {selectedActivities.length === 0 && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 4L4 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span>All</span>
                  </div>
                  
                  <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
                  
                  {/* 各个活动选项 */}
                  {getAllActivities().map(activity => (
                    <div
                      key={activity}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        fontSize: 14,
                        background: selectedActivities.includes(activity) ? '#f0f0f0' : 'transparent'
                      }}
                      onClick={() => {
                        if (selectedActivities.includes(activity)) {
                          setSelectedActivities(prev => prev.filter(a => a !== activity));
                        } else {
                          setSelectedActivities(prev => [...prev, activity]);
                        }
                      }}
                    >
                      <div style={{
                        width: 16,
                        height: 16,
                        border: '2px solid #ddd',
                        borderRadius: 3,
                        marginRight: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: selectedActivities.includes(activity) ? '#007bff' : 'transparent'
                      }}>
                        {selectedActivities.includes(activity) && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 4L4 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span>{activity}</span>
                    </div>
                  ))}
                </div>,
                document.body
              )}
                </div>
              </div>

              {/* 内容区域 */}
              <div style={{ 
                flex: 1,
                overflowY: 'auto',
                padding: '16px 24px 16px 24px',
                boxSizing: 'border-box',
                width: '100%'
              }}>
                {(() => {
                  const groupedData = groupDataByTimeGranularity(history, current, now, timeGranularity);
                  const filteredData = getFilteredData(groupedData);
                  if (!filteredData.length) {
                    return <div style={{ color: '#888', textAlign: 'center', margin: '48px 0' }}>
                      {selectedActivities.length === 0 ? 'No activity data.' : 'No data for selected activities.'}
                    </div>;
                  }

                  return filteredData.map((group, groupIndex) => {
                    const { timeKey, activities } = group;
                    const maxDuration = Math.max(...activities.map((a: any) => a.duration));
                    
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
                        <div 
                          className="summary-card"
                          style={{
                            borderRadius: 10,
                            border: '1px solid rgba(0, 0, 0, 0.10)',
                            background: '#E9F2F4',
                            maxHeight: 306,
                            overflowY: 'auto',
                            padding: 16,
                            boxSizing: 'border-box'
                          }}
                        >
                        
                        {chartType === 'Bar Chart' ? (
                          // 条形图显示
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {activities.map((activity: any) => (
                              <div key={activity.name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {/* 第一行：活动名和时间 */}
                                <div style={{ 
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
                                {/* 第二行：条形图 */}
                                <div style={{ 
                                  background: getActivityColor(activity.name),
                                  height: 16,
                                  borderRadius: 4,
                                  width: `${Math.max(20, Math.min(100, (activity.duration / maxDuration) * 100))}%`,
                                  minWidth: 20,
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
                                    const totalDuration = activities.reduce((sum: any, a: any) => sum + a.duration, 0);
                                    
                                    // 如果只有一个活动，显示完整圆形
                                    if (activities.length === 1) {
                                      const activity = activities[0];
                                      const radius = 50;
                                      const centerX = 60;
                                      const centerY = 60;
                                      
                                      return (
                                        <circle
                                          cx={centerX}
                                          cy={centerY}
                                          r={radius}
                                          fill={getActivityColor(activity.name)}
                                          stroke="#fff"
                                          strokeWidth="2"
                                        />
                                      );
                                    }
                                    
                                    // 多个活动时显示饼图
                                    let currentAngle = 0;
                                    return activities.map((activity: any) => {
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
                              {activities.map((activity: any) => (
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
                        animation: 'fadeIn 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
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
                animation: 'scaleIn 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
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
                animation: 'scaleIn 300ms linear'
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
          onScroll={throttledScrollHandler}
          onTouchMove={handleTouchMove}
          onClick={e => {
            // 如果点击的是卡片内的按钮，不处理
            if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
            setSwipeDelete(null);
          }}
          style={{
            minHeight: '100vh',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
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
            <div 
              className="activity-card-now"
              style={{
                animation: 'fadeInScale 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
              }}
            >
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
                    backgroundColor: '#E9F2F4',
                    border: 'none'
                  }} 
                  onClick={stopCurrent}
                >
                  <div style={{
                    width: '18px',
                    height: '18px',
                    backgroundColor: '#F13C3F',
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
                    key={item.startAt.getTime()}
                    style={{ 
                      position: 'relative', 
                      overflow: 'hidden', 
                      opacity: isDeleted ? 0.6 : 1, 
                      userSelect: 'none', 
                      touchAction: 'manipulation'
                    }}
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
                      key={item.startAt.getTime()}
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
      {popupRendered && (
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
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isBottomSheetClosing) {
                setIsBottomSheetClosing(true);
                setShowStartButton(false); // 立即隐藏start按钮
                // 先等待动画完成，再隐藏元素
                setTimeout(() => {
                  setShowBottomSheet(false);
                  // 立即重置关闭状态，确保popup从DOM中移除
                  setIsBottomSheetClosing(false);
                  // 立即从DOM中移除popup
                  setPopupRendered(false);
                  // 延迟显示start按钮，确保popup完全消失
                  setTimeout(() => {
                    setShowStartButton(true);
                  }, 100);
                }, 450);
              }
            }}
            onScroll={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Overlay scroll event triggered');
              if (!isBottomSheetClosing) {
                setIsBottomSheetClosing(true);
                setShowStartButton(false);
                setTimeout(() => {
                  setShowBottomSheet(false);
                  setIsBottomSheetClosing(false);
                  setPopupRendered(false);
                  setTimeout(() => {
                    setShowStartButton(true);
                  }, 100);
                }, 450);
              }
            }}
            onTouchMove={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Overlay touch move event triggered');
              if (!isBottomSheetClosing) {
                setIsBottomSheetClosing(true);
                setShowStartButton(false);
                setTimeout(() => {
                  setShowBottomSheet(false);
                  setIsBottomSheetClosing(false);
                  setPopupRendered(false);
                  setTimeout(() => {
                    setShowStartButton(true);
                  }, 100);
                }, 450);
              }
            }}
          />
          <div className="activity-bottom-sheet-fixed" style={{ 
            zIndex: 200, 
            position: 'fixed', 
            left: '50%', 
            bottom: 0, 
            transform: 'translateX(-50%)',
            animation: isBottomSheetClosing 
              ? 'slideDownToBottom 450ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' 
              : 'slideUpFromBottom 450ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
          }}>
            <div 
              className="activity-popup-inner" 
              style={{ padding: '0 24px', height: '100%', display: 'flex', flexDirection: 'column' }}
              onScroll={(e) => {
                e.stopPropagation();
              }}
              onTouchMove={(e) => {
                e.stopPropagation();
              }}
            >
              {/* 可滚动的tag区域 */}
              <div 
                style={{ 
                  flex: 1,
                  overflowY: 'auto',
                  paddingRight: '8px'
                }}
                onScroll={(e) => {
                  e.stopPropagation();
                }}
                onTouchMove={(e) => {
                  e.stopPropagation();
                }}
              >
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
                          {editingRecentActivity === activity ? (
                            <input
                              style={{
                                width: '100%',
                                height: '48px',
                                padding: '0 16px',
                                border: '1px solid #ddd',
                                borderRadius: '12px',
                                fontSize: '16px',
                                fontWeight: '500',
                                outline: 'none',
                                boxSizing: 'border-box'
                              }}
                              value={editingRecentName}
                              autoFocus
                              onChange={e => setEditingRecentName(e.target.value)}
                              onBlur={() => {
                                if (editingRecentName.trim() === '') {
                                  setEditingRecentName(activity); // 恢复原标题
                                  setEditingRecentActivity(null);
                                } else {
                                  // 更新recent activities
                                  setRecentActivities(prev => 
                                    prev.map(item => 
                                      item === activity ? editingRecentName : item
                                    )
                                  );
                                  setEditingRecentActivity(null);
                                }
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  if (editingRecentName.trim() === '') {
                                    setEditingRecentName(activity); // 恢复原标题
                                    setEditingRecentActivity(null);
                                  } else {
                                    // 更新recent activities
                                    setRecentActivities(prev => 
                                      prev.map(item => 
                                        item === activity ? editingRecentName : item
                                      )
                                    );
                                    setEditingRecentActivity(null);
                                  }
                                } else if (e.key === 'Escape') {
                                  setEditingRecentName(activity); // 恢复原标题
                                  setEditingRecentActivity(null);
                                }
                              }}
                            />
                          ) : (
                            <div
                              onTouchStart={(e) => {
                                e.preventDefault();
                                const timer = setTimeout(() => {
                                  setEditingRecentActivity(activity);
                                  setEditingRecentName(activity);
                                }, 600);
                                const cleanup = () => clearTimeout(timer);
                                document.addEventListener('touchend', cleanup, { once: true });
                                document.addEventListener('touchmove', cleanup, { once: true });
                              }}
                              onContextMenu={(e) => e.preventDefault()}
                            >
                              <Button 
                                block 
                                className="activity-btn" 
                                shape="rounded" 
                                size="large" 
                                onClick={() => startActivity(activity)}
                              >
                                {activity}
                              </Button>
                            </div>
                          )}
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
                paddingBottom: 10,
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
      {!showBottomSheet && !isBottomSheetClosing && showStartButton && !showStatsModal && !isStatsModalClosing && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: '24px',
          transform: 'translateX(-50%)',
          width: 'auto',
          background: 'transparent',
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
              whiteSpace: 'nowrap',
              boxShadow: '0px 91px 25px 0px rgba(0, 0, 0, 0.00), 0px 58px 23px 0px rgba(0, 0, 0, 0.01), 0px 33px 20px 0px rgba(0, 0, 0, 0.05), 0px 14px 14px 0px rgba(0, 0, 0, 0.09), 0px 4px 8px 0px rgba(0, 0, 0, 0.10)',
              cursor: 'pointer',
              pointerEvents: 'auto',
              animation: 'fadeInScale 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              transform: 'translateZ(0)',
              willChange: 'transform, opacity'
            }}
            onClick={() => {
              setShowBottomSheet(true);
              setPopupRendered(true);
            }}
          >
            ✨ Start Activity
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
