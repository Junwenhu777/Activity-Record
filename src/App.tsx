import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Grid } from 'antd-mobile';
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


// 获取所有历史数据的分组（用于显示完整历史）
function groupAllHistoryByDate(history: any[]) {
  const groups: Record<string, any[]> = {};
  history.forEach(item => {
    const dateStr = getDateString(item.endAt);
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(item);
  });
  return Object.entries(groups)
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
    if (copy.residents === undefined) copy.residents = [];
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
      deleted: false,
      residents: current.residents || []
    });
  }

  const groups: Record<string, any[]> = {};

  all.forEach(item => {
    let groupKey = '';
    const date = new Date(item.endAt);

    // 使用本地时间格式化日期（避免时区偏移问题）
    const localDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    switch (granularity) {
      case 'Day':
        groupKey = localDateStr; // YYYY-MM-DD (本地时间)
        break;
      case 'Week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        groupKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
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
      const summary: Record<string, {
        duration: number;
        residents: Set<string>;
        residentDurations: Record<string, number>;
      }> = {};

      items.forEach(item => {
        if (!summary[item.name]) {
          summary[item.name] = { duration: 0, residents: new Set(), residentDurations: {} };
        }
        summary[item.name].duration += item.duration;

        // 收集所有 residents 及其各自的时长
        if (item.residents && item.residents.length > 0) {
          item.residents.forEach((r: any) => {
            const name = typeof r === 'string' ? r : r.name;
            if (name) {
              summary[item.name].residents.add(name);
              // 计算该 resident 的时长：从 addedAt 到 endAt
              const addedAt = (typeof r === 'object' && r.addedAt) ? new Date(r.addedAt) : item.startAt;
              const residentDuration = new Date(item.endAt).getTime() - new Date(addedAt).getTime();
              // 累加同名 resident 在不同活动实例中的时长
              if (!summary[item.name].residentDurations[name]) {
                summary[item.name].residentDurations[name] = 0;
              }
              summary[item.name].residentDurations[name] += residentDuration;
            }
          });
        }
      });

      return {
        timeKey,
        activities: Object.entries(summary)
          .map(([name, data]) => ({
            name,
            duration: data.duration,
            residents: Array.from(data.residents),
            residentDurations: data.residentDurations
          }))
          .sort((a, b) => b.duration - a.duration)
      };
    });
}

// 格式化时间键显示
function formatTimeKey(timeKey: string, granularity: 'Day' | 'Week' | 'Month' | 'Year') {
  // 手动解析日期字符串，避免时区问题
  const parseLocalDate = (str: string) => {
    const parts = str.split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2] || '1'));
  };

  switch (granularity) {
    case 'Day':
      const dayDate = parseLocalDate(timeKey);
      return dayDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    case 'Week':
      const weekDate = parseLocalDate(timeKey);
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
  const [showBottomSheet, setShowBottomSheet] = useState(false); // 默认收起
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
  const [editingHistory, setEditingHistory] = useState<{ date?: string, idx?: number } | null>(null);
  const [editingName, setEditingName] = useState('');
  // iOS风格滑动删除状态
  const [swipeState, setSwipeState] = useState<{
    cardId: string | null;  // 'today-{idx}' 或 '{date}-{idx}'
    offset: number;         // 当前偏移量 (负数表示向左滑)
    startX: number;         // 触摸起始 X 坐标
    isDragging: boolean;    // 是否正在拖动
  }>({ cardId: null, offset: 0, startX: 0, isDragging: false });
  // 新增state用于编辑recent activity
  const [editingRecentActivity, setEditingRecentActivity] = useState<string | null>(null);
  const [editingRecentName, setEditingRecentName] = useState('');

  // RESIDENT 相关 state
  const [residents, setResidents] = useState<string[]>(() => {
    const r = localStorage.getItem('activity-residents');
    return r ? JSON.parse(r) : [];
  });
  const [selectedResidents, setSelectedResidents] = useState<string[]>([]);
  const [isAddingResident, setIsAddingResident] = useState(false);
  const [newResidentName, setNewResidentName] = useState('');
  const [editingResident, setEditingResident] = useState<string | null>(null);
  const [editingResidentName, setEditingResidentName] = useState('');

  // Card 内添加 resident 的 state
  const [showCardResidentDropdown, setShowCardResidentDropdown] = useState<string | null>(null); // 'now' | 'today-{idx}' | '{date}-{idx}'
  const [cardNewResidentName, setCardNewResidentName] = useState('');
  const [isAddingNewCardResident, setIsAddingNewCardResident] = useState(false); // 是否正在输入新名字
  const [cardDropdownPosition, setCardDropdownPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [isResidentSearching, setIsResidentSearching] = useState(false);
  const [residentSearchQuery, setResidentSearchQuery] = useState('');
  const [cardIsSearching, setCardIsSearching] = useState(false);
  const [cardSearchQuery, setCardSearchQuery] = useState('');

  // 新增 Summary popup 相关状态
  const [showDownloadOptions, setShowDownloadOptions] = useState(false);
  const [isDownloadOptionsClosing, setIsDownloadOptionsClosing] = useState(false);
  const [timeGranularity, setTimeGranularity] = useState<'Day' | 'Week' | 'Month' | 'Year'>('Day');
  const [chartType, setChartType] = useState<'Bar Chart' | 'Pie Chart'>('Bar Chart');
  const [showActivityFilter, setShowActivityFilter] = useState(false);
  const [isActivityFilterClosing, setIsActivityFilterClosing] = useState(false);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [showResidentFilter, setShowResidentFilter] = useState(false);
  const [isResidentFilterClosing, setIsResidentFilterClosing] = useState(false);
  const [selectedFilterResidents, setSelectedFilterResidents] = useState<string[]>([]);
  const [showStartButton, setShowStartButton] = useState(true); // 默认显示按钮
  const [popupRendered, setPopupRendered] = useState(false); // 默认不渲染popup

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

  // iOS风格滑动手势处理
  const SWIPE_THRESHOLD = 40; // 滑动超过40px则展开
  const SWIPE_ACTION_WIDTH = 80; // 操作按钮区域宽度

  const handleSwipeTouchStart = (e: React.TouchEvent, cardId: string) => {
    // 如果点击其他卡片，先关闭当前展开的卡片
    if (swipeState.cardId && swipeState.cardId !== cardId && swipeState.offset !== 0) {
      setSwipeState({ cardId: null, offset: 0, startX: 0, isDragging: false });
      return;
    }
    const touch = e.touches[0];
    // 如果卡片已经展开，记录当前offset作为起始状态
    const currentOffset = swipeState.cardId === cardId ? swipeState.offset : 0;
    setSwipeState({
      cardId,
      offset: currentOffset,
      startX: touch.clientX - currentOffset, // 调整startX以保持连续性
      isDragging: true
    });
  };

  const handleSwipeTouchMove = (e: React.TouchEvent, cardId: string) => {
    if (!swipeState.isDragging || swipeState.cardId !== cardId) return;
    const touch = e.touches[0];
    const diff = touch.clientX - swipeState.startX;
    // 只允许向左滑动，最大滑动距离为 SWIPE_ACTION_WIDTH
    const newOffset = Math.max(-SWIPE_ACTION_WIDTH, Math.min(0, diff));
    setSwipeState(prev => ({ ...prev, offset: newOffset }));
  };

  const handleSwipeTouchEnd = (cardId: string) => {
    if (swipeState.cardId !== cardId) return;
    // 如果滑动超过阈值，则展开；否则收起
    if (swipeState.offset < -SWIPE_THRESHOLD) {
      setSwipeState(prev => ({ ...prev, offset: -SWIPE_ACTION_WIDTH, isDragging: false }));
    } else {
      setSwipeState({ cardId: null, offset: 0, startX: 0, isDragging: false });
    }
  };

  // 关闭滑动操作
  const closeSwipe = () => {
    setSwipeState({ cardId: null, offset: 0, startX: 0, isDragging: false });
  };

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

      // 检查是否点击了 Resident 筛选下拉菜单
      if (showResidentFilter) {
        const target = e.target as Element;
        const residentFilterButton = document.querySelector('[data-resident-filter-button]');
        const residentFilterOptions = document.querySelector('[data-resident-filter-options]');

        if (residentFilterButton && !residentFilterButton.contains(target) &&
          residentFilterOptions && !residentFilterOptions.contains(target)) {
          setShowResidentFilter(false);
        }
      }

      // 检查是否点击了卡片 Resident dropdown 外部
      if (showCardResidentDropdown) {
        const target = e.target as Element;
        const cardResidentDropdown = document.querySelector('[data-card-resident-dropdown]');

        if (!cardResidentDropdown || !cardResidentDropdown.contains(target)) {
          setShowCardResidentDropdown(null);
          setCardDropdownPosition(null);
          setIsAddingNewCardResident(false);
          setCardNewResidentName('');
        }
      }

      // 检查是否点击了 popup 外部区域
      if (showStatsModal && !isStatsModalClosing) {
        const target = e.target as Element;
        const popupContent = document.querySelector('.summary-popup-content');
        const popupOuter = document.querySelector('.summary-popup-outer');

        // 如果点击的是popup内部，则不关闭
        if (popupContent && (popupContent.contains(target) || popupContent === target)) {
          console.log('Click inside popup content, ignoring');
          return;
        }
        if (popupOuter && (popupOuter.contains(target) || popupOuter === target)) {
          console.log('Click inside popup outer, ignoring');
          return;
        }

        // 点击了 popup 外部区域，开始关闭动画
        // 防止重复触发
        if (!isStatsModalClosing) {
          console.log('Click outside popup, closing');
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
    };

    if (showDownloadOptions || showActivityFilter || showResidentFilter || showStatsModal || showCardResidentDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDownloadOptions, showActivityFilter, showResidentFilter, showStatsModal, isStatsModalClosing, showCardResidentDropdown]);

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
  useEffect(() => {
    localStorage.setItem('activity-residents', JSON.stringify(residents));
  }, [residents]);

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

  // 当半屏弹窗打开时锁定 body 滚动，防止背景页面滚动穿透
  useEffect(() => {
    if (showBottomSheet || showStatsModal) {
      // 保存当前滚动位置
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';

      return () => {
        // 恢复滚动
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [showBottomSheet, showStatsModal]);



  // 结束当前活动并记录
  const stopCurrent = () => {
    if (!current) return;
    const endAt = new Date();
    const duration = endAt.getTime() - current.startAt.getTime();
    const newHistoryItem = {
      name: current.name,
      startAt: current.startAt,
      endAt,
      duration,
      deleted: false,
      residents: current.residents || []
    };
    setHistory(prevHistory => [newHistoryItem, ...prevHistory]);
    setCurrent(null);
    setSelectedResidents([]); // 重置选中的 residents
  };

  // 开始新活动（自动结束当前活动）
  const startActivity = (name: string) => {
    // 如果正在编辑 Resident 且名字不为空，优先处理 Resident 编辑，不启动 Activity
    if (editingResident || (isAddingResident && newResidentName)) return;
    if (!name) return;
    if (current) {
      stopCurrent();
    }
    // 将选中的 residents 转换为对象格式，包含 addedAt
    const residentsWithTime = selectedResidents.map(r => ({ name: r, addedAt: new Date() }));
    setCurrent({ name, startAt: new Date(), deleted: false, residents: residentsWithTime });
    setActivityName('');
    setSelectedResidents([]); // 始终重置选中的 residents，确保下次打开时从空白开始

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

    // 自动关闭半屏
    if (showBottomSheet && !isBottomSheetClosing) {
      setIsBottomSheetClosing(true);
      setShowStartButton(false);
      setTimeout(() => {
        setShowBottomSheet(false);
        setEditingRecentActivity(null);
        setEditingRecentName('');
        setIsBottomSheetClosing(false);
        setPopupRendered(false);
        setTimeout(() => {
          setShowStartButton(true);
        }, 100);
      }, 450);
    }
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

    // 检查滚动事件是否来自popup内部
    const target = e.target as Element;
    const popupContent = document.querySelector('.summary-popup-content');
    const popupOuter = document.querySelector('.summary-popup-outer');
    const activityPopupInner = document.querySelector('.activity-popup-inner');
    const activityBottomSheetFixed = document.querySelector('.activity-bottom-sheet-fixed');

    // 如果滚动事件来自popup内部，则不关闭popup
    if (popupContent && (popupContent.contains(target) || popupContent === target)) {
      console.log('Scroll event from popup content in throttled handler, ignoring');
      return;
    }
    if (popupOuter && (popupOuter.contains(target) || popupOuter === target)) {
      console.log('Scroll event from popup outer in throttled handler, ignoring');
      return;
    }
    if (activityPopupInner && (activityPopupInner.contains(target) || activityPopupInner === target)) {
      console.log('Scroll event from activity popup inner in throttled handler, ignoring');
      return;
    }
    if (activityBottomSheetFixed && (activityBottomSheetFixed.contains(target) || activityBottomSheetFixed === target)) {
      console.log('Scroll event from activity bottom sheet fixed in throttled handler, ignoring');
      return;
    }

    // 只有主内容区的滚动才收起popup并显示start按钮
    // 如果popup打开了(popupRendered)，则忽略滚动事件(防止键盘收起触发滚动导致误关)
    if (popupRendered) return;

    if (!isBottomSheetClosing) {
      // 检查是否有popup交互标志
      const popupContainer = document.querySelector('.activity-bottom-sheet-fixed');
      const hasRecentInteraction = popupContainer && popupContainer.getAttribute('data-recent-interaction') === 'true';

      if (!hasRecentInteraction) {
        console.log('Closing popup due to main content scroll');
        setIsBottomSheetClosing(true);
        setShowStartButton(false);
        setTimeout(() => {
          setShowBottomSheet(false);
          setEditingRecentActivity(null);
          setEditingRecentName('');
          // 立即重置关闭状态，确保popup从DOM中移除
          setIsBottomSheetClosing(false);
          // 立即从DOM中移除popup
          setPopupRendered(false);
          // 延迟显示start按钮，确保popup完全消失
          setTimeout(() => {
            setShowStartButton(true);
          }, 100);
        }, 450);
      } else {
        console.log('Popup has recent interaction, not closing');
      }
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
  // 历史分组，显示所有历史数据（排除今天，因为今天已经在 Today 区域显示了）
  const todayDateStr = getDateString(now);
  const groupedHistory = groupAllHistoryByDate(history);
  const displayHistory: [string, any[]][] = (groupedHistory as [string, any[]][]).filter(([date]) => date !== todayDateStr);

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

    // 添加一个标志来防止popup意外关闭
    let isPopupInteraction = false;

    // 监听popup内的交互事件
    const handlePopupInteraction = () => {
      isPopupInteraction = true;
      const popupContainer = document.querySelector('.activity-bottom-sheet-fixed');
      if (popupContainer) {
        popupContainer.setAttribute('data-recent-interaction', 'true');
        setTimeout(() => {
          popupContainer.removeAttribute('data-recent-interaction');
          isPopupInteraction = false;
        }, 1000); // 1秒内不关闭popup
      }
    };

    const popupContainer = document.querySelector('.activity-bottom-sheet-fixed');
    if (popupContainer) {
      popupContainer.addEventListener('touchstart', handlePopupInteraction, { passive: true });
      popupContainer.addEventListener('click', handlePopupInteraction, { passive: true });
      popupContainer.addEventListener('focusin', handlePopupInteraction, { passive: true });
    }

    // handleGlobalScroll removed


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
      if (!isBottomSheetClosing && !isPopupInteraction) {
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

    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });

    return () => {
      window.removeEventListener('touchmove', handleGlobalTouchMove);

      // 清理popup交互监听器
      const popupContainer = document.querySelector('.activity-bottom-sheet-fixed');
      if (popupContainer) {
        popupContainer.removeEventListener('touchstart', handlePopupInteraction);
        popupContainer.removeEventListener('click', handlePopupInteraction);
        popupContainer.removeEventListener('focusin', handlePopupInteraction);
      }
    };
  }, [popupRendered, isBottomSheetClosing]);

  // 安全守卫：防止 isBottomSheetClosing 卡死导致半屏无法唤起
  useEffect(() => {
    if (isBottomSheetClosing) {
      const timer = setTimeout(() => {
        console.warn('Force reseting stuck isBottomSheetClosing state');
        setIsBottomSheetClosing(false);
        setPopupRendered(false);
        setShowStartButton(true);
        setShowBottomSheet(false);
        setEditingRecentActivity(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isBottomSheetClosing]);

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

  // 活动和 Resident 筛选逻辑
  const getFilteredData = (data: any[]) => {
    return data.map(group => ({
      ...group,
      activities: group.activities
        .filter((activity: any) => {
          // 活动名称筛选
          const activityMatch = selectedActivities.length === 0 || selectedActivities.includes(activity.name);

          // Resident 筛选 - activity.residents 现在是字符串数组
          const residentMatch = selectedFilterResidents.length === 0 ||
            (activity.residents && activity.residents.length > 0 && activity.residents.some((r: string) => {
              return selectedFilterResidents.includes(r);
            }));

          return activityMatch && residentMatch;
        })
        .map((activity: any) => {
          // 如果选择了特定 Residents，重新计算该活动的时长
          if (selectedFilterResidents.length > 0 && activity.residentDurations) {
            const filteredDuration = selectedFilterResidents.reduce((sum: number, r: string) => {
              return sum + (activity.residentDurations[r] || 0);
            }, 0);
            return { ...activity, duration: filteredDuration };
          }
          return activity;
        })
        .filter((activity: any) => activity.duration > 0) // 过滤掉时长为0的活动
    })).filter(group => group.activities.length > 0);
  };

  // 获取所有 resident 名字（从 history 和 current 中提取）
  const getAllResidentsFromHistory = (): string[] => {
    const residentSet = new Set<string>();
    // 从 residents 列表获取
    residents.forEach(r => {
      if (r && r.trim()) residentSet.add(r);
    });
    // 从 history 中获取
    history.forEach(item => {
      if (item.residents) {
        item.residents.forEach((r: any) => {
          const name = typeof r === 'string' ? r : r.name;
          if (name && name.trim()) residentSet.add(name);
        });
      }
    });
    // 从 current 中获取
    if (current && current.residents) {
      current.residents.forEach((r: any) => {
        const name = typeof r === 'string' ? r : r.name;
        if (name && name.trim()) residentSet.add(name);
      });
    }
    return Array.from(residentSet).sort();
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
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8
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
              <img src="/logo.png" alt="logo" style={{ height: '1.2em', width: 'auto' }} />
              Activity Records
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="#003746" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 17V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V17" stroke="#003746" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
                        <path d="M15.5625 16.1953H2.4375V14.9961H15.5625V16.1953ZM9.59961 10.8672L12.5137 7.95312L13.3613 8.80078L9.42383 12.7383C9.18952 12.9726 8.81048 12.9726 8.57617 12.7383L4.63867 8.80078L5.48633 7.95312L8.40039 10.8672V1.81445H9.59961V10.8672Z" fill="black" fillOpacity="0.85" />
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
                          zIndex: 9999999,
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

                              // 导出所有数据（包括已删除的），deleted 字段会正确反映删除状态
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

                              // 按结束时间排序，最新的在前
                              all.sort((a, b) => b.endAt.getTime() - a.endAt.getTime());

                              console.log('Data prepared:', all.length, 'items');
                              console.log('Sample data:', all[0]);
                              console.log('All data for export:', all.map(item => ({
                                name: item.name,
                                startDate: getDateString(item.startAt),
                                startAt: formatTime(item.startAt),
                                endDate: getDateString(item.endAt),
                                endAt: formatTime(item.endAt),
                                duration: formatHMS(Math.round(item.duration / 1000)),
                                deleted: item.deleted
                              })));
                              console.log('Deleted items count:', all.filter(item => item.deleted).length);
                              console.log('Total items count:', all.length);

                              // 新格式：每个 resident 对应一行
                              // Resident Name | Activity | Start Date | Start At | End Date | End At | Duration | Seconds | Deleted
                              const rows: any[] = [];

                              all.forEach(item => {
                                const itemResidents = item.residents || [];

                                if (itemResidents.length === 0) {
                                  // 没有 resident 的 activity，Resident Name 为空
                                  rows.push({
                                    'Resident Name': '',
                                    Activity: item.name,
                                    'Start Date': getDateString(item.startAt),
                                    'Start At': formatTime(item.startAt),
                                    'End Date': getDateString(item.endAt),
                                    'End At': formatTime(item.endAt),
                                    Duration: formatHMS(Math.round(item.duration / 1000)),
                                    Seconds: Math.round(item.duration / 1000),
                                    Deleted: item.deleted ? 'true' : 'false'
                                  });
                                } else {
                                  // 每个 resident 生成一行
                                  itemResidents.forEach((r: any) => {
                                    const residentName = typeof r === 'string' ? r : r.name;
                                    // 如果 resident 有 addedAt 时间，使用它作为该 resident 的开始时间
                                    // 否则使用活动的开始时间
                                    const residentStartAt = (typeof r === 'object' && r.addedAt)
                                      ? new Date(r.addedAt)
                                      : item.startAt;
                                    // 计算该 resident 的 duration（从 addedAt 到活动结束）
                                    const residentDuration = item.endAt.getTime() - residentStartAt.getTime();
                                    rows.push({
                                      'Resident Name': residentName,
                                      Activity: item.name,
                                      'Start Date': getDateString(residentStartAt),
                                      'Start At': formatTime(residentStartAt),
                                      'End Date': getDateString(item.endAt),
                                      'End At': formatTime(item.endAt),
                                      Duration: formatHMS(Math.round(residentDuration / 1000)),
                                      Seconds: Math.round(residentDuration / 1000),
                                      Deleted: item.deleted ? 'true' : 'false'
                                    });
                                  });
                                }
                              });

                              // 列顺序
                              const columnOrder = ['Resident Name', 'Activity', 'Start Date', 'Start At', 'End Date', 'End At', 'Duration', 'Seconds', 'Deleted'];
                              const reorderedRows = rows.map(row => {
                                const newRow: any = {};
                                columnOrder.forEach(col => {
                                  if (row.hasOwnProperty(col)) {
                                    newRow[col] = row[col];
                                  }
                                });
                                return newRow;
                              });

                              console.log('Creating worksheet...');
                              const ws = XLSX.utils.json_to_sheet(reorderedRows);
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
                      <path d="M14.158 5.27173L9.98804 9.44165L14.158 13.6116L13.3103 14.4592L9.14038 10.2893L4.97046 14.4592L4.1228 13.6116L8.29272 9.44165L4.1228 5.27173L4.97046 4.42407L9.14038 8.59399L13.3103 4.42407L14.158 5.27173Z" fill="black" fillOpacity="0.85" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 筛选选项区 */}
              <div style={{
                padding: '16px 24px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                boxSizing: 'border-box'
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
                      <path d="M4.81921 7.20288L9.41296 11.7966L14.0067 7.20288" stroke="black" strokeWidth="1.2" strokeLinejoin="round" />
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
                      <path d="M4.81921 7.20288L9.41296 11.7966L14.0067 7.20288" stroke="black" strokeWidth="1.2" strokeLinejoin="round" />
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
                      <path d="M4.81921 7.20288L9.41296 11.7966L14.0067 7.20288" stroke="black" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                  </div>

                  {/* 活动筛选下拉菜单 - 使用Portal渲染到body顶层 */}
                  {(showActivityFilter || isActivityFilterClosing) && createPortal(
                    <div
                      data-activity-filter-options
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
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
                              <path d="M1 4L4 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
                                <path d="M1 4L4 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

                {/* Resident 筛选下拉菜单 */}
                {residents.length > 0 && (
                  <div style={{ position: 'relative', width: 'fit-content', zIndex: 999998 }}>
                    <div
                      data-resident-filter-button
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
                        if (showResidentFilter) {
                          setIsResidentFilterClosing(true);
                          setTimeout(() => {
                            setShowResidentFilter(false);
                            setIsResidentFilterClosing(false);
                          }, 300);
                        } else {
                          setShowResidentFilter(true);
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
                        {selectedFilterResidents.length === 0 ? 'All Residents' : `${selectedFilterResidents.length} Resident${selectedFilterResidents.length > 1 ? 's' : ''}`}
                      </span>
                      <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4.81921 7.20288L9.41296 11.7966L14.0067 7.20288" stroke="black" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    </div>

                    {/* Resident 筛选下拉菜单 - 使用Portal渲染到body顶层 */}
                    {(showResidentFilter || isResidentFilterClosing) && createPortal(
                      <div
                        data-resident-filter-options
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: 'fixed',
                          top: (() => {
                            const button = document.querySelector('[data-resident-filter-button]');
                            if (button) {
                              const rect = button.getBoundingClientRect();
                              return rect.bottom + 4;
                            }
                            return '50%';
                          })(),
                          left: (() => {
                            const button = document.querySelector('[data-resident-filter-button]');
                            if (button) {
                              const rect = button.getBoundingClientRect();
                              const menuWidth = 200;
                              const screenWidth = window.innerWidth;
                              const rightEdge = rect.left + menuWidth;

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
                          zIndex: 999998,
                          scrollbarWidth: 'none',
                          msOverflowStyle: 'none',
                          animation: isResidentFilterClosing
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
                            background: selectedFilterResidents.length === 0 ? '#f0f0f0' : 'transparent'
                          }}
                          onClick={() => {
                            setSelectedFilterResidents([]);
                            setShowResidentFilter(false);
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
                            background: selectedFilterResidents.length === 0 ? '#007bff' : 'transparent'
                          }}>
                            {selectedFilterResidents.length === 0 && (
                              <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 4L4 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <span>All Residents</span>
                        </div>

                        <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />

                        {/* 各个 Resident 选项 */}
                        {/* Residents 列表 - 使用从 history 中提取的所有 resident */}
                        {getAllResidentsFromHistory().map(resident => (
                          <div
                            key={resident}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '8px 12px',
                              cursor: 'pointer',
                              borderRadius: 4,
                              fontSize: 14,
                              background: selectedFilterResidents.includes(resident) ? '#f0f0f0' : 'transparent'
                            }}
                            onClick={() => {
                              if (selectedFilterResidents.includes(resident)) {
                                setSelectedFilterResidents(prev => prev.filter(r => r !== resident));
                              } else {
                                setSelectedFilterResidents(prev => [...prev, resident]);
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
                              background: selectedFilterResidents.includes(resident) ? '#007bff' : 'transparent'
                            }}>
                              {selectedFilterResidents.includes(resident) && (
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M1 4L4 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                            <span>{resident}</span>
                          </div>
                        ))}
                      </div>,
                      document.body
                    )}
                  </div>
                )}
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
            closeSwipe();
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
              onClick={() => {
                // 点击卡片其他区域取消新增 resident
                if (showCardResidentDropdown === 'now') {
                  setShowCardResidentDropdown(null);
                  setCardNewResidentName('');
                }
              }}
            >
              <div>
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
                  <>
                    {/* Residents 横向滚动显示 - 在 title 上方，带 add 按钮 - 独立占满宽度 */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 4,
                      overflowX: 'auto',
                      scrollbarWidth: 'none',
                      msOverflowStyle: 'none'
                    }}>
                      {/* Add resident 按钮 */}
                      <button
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          border: '1px dashed #ccc',
                          background: '#fff',
                          cursor: 'pointer',
                          padding: 0,
                          flexShrink: 0,
                          position: 'relative'
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (showCardResidentDropdown === 'now') {
                            setShowCardResidentDropdown(null);
                            setCardDropdownPosition(null);
                          } else {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const MENU_HEIGHT = 320;
                            const viewportHeight = window.innerHeight;
                            if (rect.bottom + MENU_HEIGHT > viewportHeight) {
                              // Place above
                              setCardDropdownPosition({ bottom: viewportHeight - rect.top + 4, left: rect.left });
                            } else {
                              // Place below
                              setCardDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                            }
                            setShowCardResidentDropdown('now');
                          }
                          setIsAddingNewCardResident(false);
                          setCardNewResidentName('');
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                          <path d="M7 1V13M1 7H13" stroke="#666" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>

                      {/* Dropdown menu - 使用 Portal 渲染到顶层 */}
                      {showCardResidentDropdown === 'now' && cardDropdownPosition && createPortal(
                        <>
                          {/* 全屏透明遮罩 - 用于点击关闭和防止背景滚动 */}
                          <div
                            style={{
                              position: 'fixed',
                              inset: 0,
                              zIndex: 999998,
                              background: 'transparent',
                              touchAction: 'none' // 阻止底层滚动
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowCardResidentDropdown(null);
                              setCardNewResidentName('');
                              setIsAddingNewCardResident(false);
                              setCardIsSearching(false);
                              setCardSearchQuery('');
                            }}
                            onTouchMove={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          />

                          {/* 菜单内容 */}
                          <div
                            data-card-resident-dropdown
                            style={{
                              position: 'fixed',
                              top: cardDropdownPosition.top,
                              bottom: cardDropdownPosition.bottom,
                              left: 48,
                              right: 48,
                              width: 'auto', // 自适应宽度
                              background: '#fff',
                              borderRadius: 16,
                              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                              padding: '20px 24px', // 增加内边距
                              maxHeight: 300,
                              overflowY: 'auto',
                              zIndex: 999999,
                              display: 'flex',
                              flexDirection: 'column',
                              overscrollBehavior: 'contain'
                            }}
                            onClick={e => e.stopPropagation()}
                            onTouchMove={e => e.stopPropagation()}
                          >
                            {/* 标题栏: Resident + Add Button */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 12
                            }}>
                              <div style={{
                                fontSize: 12,
                                fontWeight: 400, // Regular weight
                                color: '#666',
                                textTransform: 'uppercase',
                                letterSpacing: 0.5
                              }}>
                                Resident
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {/* Search Button */}
                                {!isAddingNewCardResident && !cardIsSearching && (
                                  <button
                                    style={{
                                      width: 24,
                                      height: 24,
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      padding: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCardIsSearching(true);
                                      setIsAddingNewCardResident(false);
                                    }}
                                  >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(2, 48, 59, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                  </button>
                                )}
                                {/* Add Button */}
                                {!cardIsSearching && !isAddingNewCardResident && (
                                  <button
                                    style={{
                                      width: 24,
                                      height: 24,
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      padding: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setIsAddingNewCardResident(true);
                                      setCardIsSearching(false);
                                    }}
                                  >
                                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M10.0004 1.90845C14.469 1.9088 18.0921 5.53156 18.0921 10.0002C18.0918 14.4686 14.4687 18.0917 10.0004 18.092C5.53166 18.092 1.90891 14.4688 1.90855 10.0002C1.90855 5.53134 5.53145 1.90845 10.0004 1.90845ZM10.0004 3.50806C6.4151 3.50806 3.50816 6.415 3.50816 10.0002C3.50852 13.5852 6.41532 16.4915 10.0004 16.4915C13.5851 16.4911 16.4912 13.585 16.4916 10.0002C16.4916 6.41521 13.5853 3.50841 10.0004 3.50806ZM10.7992 9.19946H13.6459V10.7991H10.7992V13.6458H9.19957V10.7991H6.35387V9.19946H9.19957V6.35376H10.7992V9.19946Z" fill="rgba(2, 48, 59, 0.85)" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Shared Input Area */}
                            {(cardIsSearching || isAddingNewCardResident) && (
                              <div style={{ marginBottom: 12 }}>
                                <input
                                  style={{
                                    width: '100%',
                                    height: '44px',
                                    padding: '0 16px',
                                    border: '1px solid #00313c',
                                    borderRadius: '12px',
                                    fontSize: '16px',
                                    fontWeight: '500',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                    background: '#f5f9fa',
                                    color: '#222'
                                  }}
                                  placeholder={cardIsSearching ? "Search resident..." : "Enter resident name"}
                                  value={cardIsSearching ? cardSearchQuery : cardNewResidentName}
                                  autoFocus
                                  onChange={e => {
                                    if (cardIsSearching) {
                                      setCardSearchQuery(e.target.value);
                                    } else {
                                      setCardNewResidentName(e.target.value);
                                    }
                                  }}
                                  onBlur={() => {
                                    // Optional: logic to close or keep open, prioritizing user intent
                                    // If empty, maybe close?
                                    if (cardIsSearching && !cardSearchQuery) setCardIsSearching(false);
                                    if (isAddingNewCardResident && !cardNewResidentName) setIsAddingNewCardResident(false);
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') {
                                      if (cardIsSearching) {
                                        setCardSearchQuery('');
                                        setCardIsSearching(false);
                                      } else {
                                        setCardNewResidentName('');
                                        setIsAddingNewCardResident(false);
                                      }
                                    } else if (e.key === 'Enter') {
                                      if (isAddingNewCardResident && cardNewResidentName.trim()) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const newName = cardNewResidentName.trim();
                                        // Logic update: Remove duplicates and move to top
                                        setResidents(prev => {
                                          const filtered = prev.filter(r => r !== newName);
                                          return [newName, ...filtered];
                                        });

                                        const newResidentEntry = { name: newName, addedAt: new Date() };
                                        const currentResidents = current.residents || [];
                                        if (!currentResidents.some((r: any) => (typeof r === 'string' ? r : r.name) === newName)) {
                                          setCurrent({ ...current, residents: [newResidentEntry, ...currentResidents] });
                                        }
                                        setCardNewResidentName('');
                                        setIsAddingNewCardResident(false);
                                      }
                                    }
                                  }}
                                  onClick={e => e.stopPropagation()}
                                />
                              </div>
                            )}

                            {/* Residents List */}
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 12
                            }}>
                              {residents.filter(r => !cardIsSearching || r.toLowerCase().includes(cardSearchQuery.toLowerCase())).map(resident => {
                                const currentResidents = current.residents || [];
                                const isSelected = currentResidents.some((cr: any) => (typeof cr === 'string' ? cr : cr.name) === resident);
                                return (
                                  <button
                                    key={resident}
                                    style={{
                                      background: isSelected ? '#00313c' : '#E9F2F4',
                                      color: isSelected ? '#fff' : '#222',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'flex-start',
                                      gap: 4,
                                      padding: '12px 16px',
                                      borderRadius: 12,
                                      border: '1px solid rgba(2, 48, 59, 0.04)',
                                      cursor: 'pointer',
                                      fontSize: 15, // Unified font size
                                      fontWeight: 500,
                                      textAlign: 'left',
                                      width: '100%',
                                      userSelect: 'none',
                                      WebkitUserSelect: 'none'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isSelected) {
                                        const newResidents = currentResidents.filter((r: any) => {
                                          const name = typeof r === 'string' ? r : r.name;
                                          return name !== resident;
                                        });
                                        setCurrent({ ...current, residents: newResidents });
                                      } else {
                                        const newResidentEntry = { name: resident, addedAt: new Date() };
                                        setCurrent({ ...current, residents: [newResidentEntry, ...currentResidents] });
                                      }
                                      // Search Exit Logic
                                      if (cardIsSearching) {
                                        setCardIsSearching(false);
                                        setCardSearchQuery('');
                                      }
                                    }}
                                  >
                                    <span style={{
                                      boxSizing: 'border-box', // Fix size shift
                                      width: 16,
                                      height: 16,
                                      border: isSelected ? '2px solid #fff' : '1px solid rgba(2, 48, 59, 0.4)',
                                      borderRadius: '50%',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0
                                    }}>
                                      {isSelected && (
                                        <span style={{
                                          width: 8,
                                          height: 8,
                                          background: '#fff',
                                          borderRadius: '50%'
                                        }} />
                                      )}
                                    </span>
                                    {resident}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>,
                        document.body
                      )}

                      {/* Residents tags - 横向滚动 */}
                      {current.residents && current.residents.length > 0 && current.residents
                        .filter((resident: any) => {
                          const residentName = typeof resident === 'string' ? resident : resident.name;
                          return residentName && residentName.trim() !== '';
                        })
                        .map((resident: any) => {
                          const residentName = typeof resident === 'string' ? resident : resident.name;
                          return (
                            <span
                              key={residentName}
                              style={{
                                background: '#E9F2F4',
                                color: '#00313c',
                                padding: '4px 12px',
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                flexShrink: 0
                              }}
                            >
                              {residentName}
                            </span>
                          );
                        })}
                    </div>
                    <div className="activity-card-title" style={{ fontSize: 24, cursor: 'pointer' }} onClick={() => { setEditingCurrentName(true); setEditingName(current.name); }}>{current.name}</div>
                  </>
                )}
                {/* 下方内容和 End 按钮并排 */}
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <div className="activity-card-label">Start At: {formatTime(current.startAt)}</div>
                    <div className="activity-card-label">Duration: {formatDuration(now.getTime() - current.startAt.getTime())}</div>
                    <div className="activity-card-label">End At: -</div>
                  </div>
                  <Button
                    color="danger"
                    shape="rounded"
                    size="mini"
                    style={{
                      width: 48,
                      minWidth: 48,
                      height: 48,
                      minHeight: 48,
                      borderRadius: '50%',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#E9F2F4',
                      border: 'none',
                      flexShrink: 0
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
            </div>
          )}
          {/* 今天的活动卡片流 */}
          {todaysActivities.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {todaysActivities.map((item, idx) => {
                const cardId = `today-${idx}`;
                const currentOffset = swipeState.cardId === cardId ? swipeState.offset : 0;
                const isDeleted = item.deleted;
                return (
                  <div
                    key={item.startAt.getTime()}
                    style={{
                      position: 'relative',
                      overflow: 'hidden',
                      marginBottom: 12,
                      borderRadius: 16
                    }}
                  >
                    {/* 背景操作按钮区域 - 固定在右侧，与卡片10px间距 */}
                    <div style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: SWIPE_ACTION_WIDTH - 10,
                      marginRight: 0,
                      display: 'flex',
                      alignItems: 'stretch',
                      justifyContent: 'center',
                      background: isDeleted ? '#00b96b' : '#d70015',
                      borderRadius: 16,
                      opacity: Math.min(1, Math.abs(currentOffset) / 20),
                      visibility: currentOffset === 0 ? 'hidden' : 'visible',
                      transition: swipeState.isDragging ? 'none' : 'opacity 0.2s ease'
                    }}>
                      <button
                        style={{
                          background: 'transparent',
                          color: '#fff',
                          border: 'none',
                          padding: '8px 16px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: 14,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '100%',
                          height: '100%',
                          opacity: Math.min(1, Math.abs(currentOffset) / 40)
                        }}
                        onClick={() => {
                          const newHistory = [...history];
                          const todayIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                          if (todayIdx !== -1) {
                            newHistory[todayIdx].deleted = !isDeleted;
                            setHistory(newHistory);
                          }
                          closeSwipe();
                        }}
                      >
                        {isDeleted ? 'Recover' : 'Delete'}
                      </button>
                    </div>

                    {/* 可滑动的卡片内容 */}
                    <div
                      className="activity-card-history"
                      style={{
                        position: 'relative',
                        opacity: isDeleted ? 0.6 : 1,
                        userSelect: 'none',
                        touchAction: 'pan-y',
                        transform: `translateX(${currentOffset}px)`,
                        transition: swipeState.isDragging ? 'none' : 'transform 0.3s ease',
                        willChange: 'transform',
                        marginBottom: 0 // 覆盖CSS的margin，让按钮高度与卡片一致
                      }}
                      onTouchStart={(e) => handleSwipeTouchStart(e, cardId)}
                      onTouchMove={(e) => handleSwipeTouchMove(e, cardId)}
                      onTouchEnd={() => handleSwipeTouchEnd(cardId)}
                    >
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
                        <>
                          {/* Residents 横向滚动显示 - 在 title 上方，带 add 按钮 */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 4,
                            overflowX: 'auto',
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none'
                          }}>
                            {/* Add resident 按钮 */}
                            <button
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: '50%',
                                border: '1px dashed #ccc',
                                background: '#fff',
                                cursor: 'pointer',
                                padding: 0,
                                flexShrink: 0,
                                position: 'relative'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (showCardResidentDropdown === `today-${idx}`) {
                                  setShowCardResidentDropdown(null);
                                  setCardDropdownPosition(null);
                                } else {
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  const MENU_HEIGHT = 320;
                                  const viewportHeight = window.innerHeight;
                                  if (rect.bottom + MENU_HEIGHT > viewportHeight) {
                                    // Place above
                                    setCardDropdownPosition({ bottom: viewportHeight - rect.top + 4, left: rect.left });
                                  } else {
                                    // Place below
                                    setCardDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                                  }
                                  setShowCardResidentDropdown(`today-${idx}`);
                                }
                                setIsAddingNewCardResident(false);
                                setCardNewResidentName('');
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                                <path d="M7 1V13M1 7H13" stroke="#666" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </button>

                            {/* Dropdown menu - 使用 Portal 渲染到顶层 */}
                            {showCardResidentDropdown === `today-${idx}` && cardDropdownPosition && createPortal(
                              <>
                                {/* 全屏透明遮罩 */}
                                <div
                                  style={{
                                    position: 'fixed',
                                    inset: 0,
                                    zIndex: 999998,
                                    background: 'transparent',
                                    touchAction: 'none'
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowCardResidentDropdown(null);
                                    setCardNewResidentName('');
                                    setIsAddingNewCardResident(false);
                                    setCardIsSearching(false);
                                    setCardSearchQuery('');
                                  }}
                                  onTouchMove={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                />

                                {/* 菜单内容 */}
                                <div
                                  data-card-resident-dropdown
                                  style={{
                                    position: 'fixed',
                                    top: cardDropdownPosition.top,
                                    bottom: cardDropdownPosition.bottom,
                                    left: 48,
                                    right: 48,
                                    width: 'auto',
                                    background: '#fff',
                                    borderRadius: 16,
                                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                                    padding: '20px 24px',
                                    maxHeight: 300,
                                    overflowY: 'auto',
                                    zIndex: 999999,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overscrollBehavior: 'contain'
                                  }}
                                  onClick={e => e.stopPropagation()}
                                  onTouchMove={e => e.stopPropagation()}
                                >
                                  {/* 标题栏 */}
                                  {/* 标题栏 */}
                                  <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: 12
                                  }}>
                                    <div style={{
                                      fontSize: 12,
                                      fontWeight: 400,
                                      color: '#666',
                                      textTransform: 'uppercase',
                                      letterSpacing: 0.5
                                    }}>
                                      Resident
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                      {/* Search Button */}
                                      {!isAddingNewCardResident && !cardIsSearching && (
                                        <button
                                          style={{
                                            width: 24,
                                            height: 24,
                                            border: 'none',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            padding: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCardIsSearching(true);
                                            setIsAddingNewCardResident(false);
                                          }}
                                        >
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(2, 48, 59, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                        </button>
                                      )}
                                      {/* Add Button */}
                                      {!cardIsSearching && !isAddingNewCardResident && (
                                        <button
                                          style={{
                                            width: 24,
                                            height: 24,
                                            border: 'none',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            padding: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setIsAddingNewCardResident(true);
                                            setCardIsSearching(false);
                                          }}
                                        >
                                          <svg width="24" height="24" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10.0004 1.90845C14.469 1.9088 18.0921 5.53156 18.0921 10.0002C18.0918 14.4686 14.4687 18.0917 10.0004 18.092C5.53166 18.092 1.90891 14.4688 1.90855 10.0002C1.90855 5.53134 5.53145 1.90845 10.0004 1.90845ZM10.0004 3.50806C6.4151 3.50806 3.50816 6.415 3.50816 10.0002C3.50852 13.5852 6.41532 16.4915 10.0004 16.4915C13.5851 16.4911 16.4912 13.585 16.4916 10.0002C16.4916 6.41521 13.5853 3.50841 10.0004 3.50806ZM10.7992 9.19946H13.6459V10.7991H10.7992V13.6458H9.19957V10.7991H6.35387V9.19946H9.19957V6.35376H10.7992V9.19946Z" fill="rgba(2, 48, 59, 0.85)" />
                                          </svg>
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Shared Input Area */}
                                  {(cardIsSearching || isAddingNewCardResident) && (
                                    <div style={{ marginBottom: 12 }}>
                                      <input
                                        style={{
                                          width: '100%',
                                          height: '44px',
                                          padding: '0 16px',
                                          border: '1px solid #00313c',
                                          borderRadius: '12px',
                                          fontSize: '16px',
                                          fontWeight: '500',
                                          outline: 'none',
                                          boxSizing: 'border-box',
                                          background: '#f5f9fa',
                                          color: '#222'
                                        }}
                                        placeholder={cardIsSearching ? "Search resident..." : "Enter resident name"}
                                        value={cardIsSearching ? cardSearchQuery : cardNewResidentName}
                                        autoFocus
                                        onChange={e => {
                                          if (cardIsSearching) {
                                            setCardSearchQuery(e.target.value);
                                          } else {
                                            setCardNewResidentName(e.target.value);
                                          }
                                        }}
                                        onBlur={() => {
                                          if (cardIsSearching && !cardSearchQuery) setCardIsSearching(false);
                                          if (isAddingNewCardResident && !cardNewResidentName) setIsAddingNewCardResident(false);
                                        }}
                                        onKeyDown={e => {
                                          if (e.key === 'Escape') {
                                            if (cardIsSearching) {
                                              setCardSearchQuery('');
                                              setCardIsSearching(false);
                                            } else {
                                              setCardNewResidentName('');
                                              setIsAddingNewCardResident(false);
                                            }
                                          } else if (e.key === 'Enter') {
                                            if (isAddingNewCardResident && cardNewResidentName.trim()) {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              const newName = cardNewResidentName.trim();
                                              // Deduplicate logic
                                              setResidents(prev => {
                                                const filtered = prev.filter(r => r !== newName);
                                                return [newName, ...filtered];
                                              });

                                              const newHistory = [...history];
                                              const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                                              if (histIdx !== -1) {
                                                const currentResidents = newHistory[histIdx].residents || [];
                                                const residentNames = currentResidents.map((r: any) => typeof r === 'string' ? r : r.name);
                                                if (!residentNames.includes(newName)) {
                                                  newHistory[histIdx].residents = [newName, ...currentResidents];
                                                  setHistory(newHistory);
                                                }
                                              }
                                              setCardNewResidentName('');
                                              setIsAddingNewCardResident(false);
                                            }
                                          }
                                        }}
                                        onClick={e => e.stopPropagation()}
                                      />
                                    </div>
                                  )}

                                  {/* List */}
                                  <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12
                                  }}>
                                    {residents.filter(r => !cardIsSearching || r.toLowerCase().includes(cardSearchQuery.toLowerCase())).map(resident => {
                                      const itemResidents = item.residents || [];
                                      const isSelected = itemResidents.some((ir: any) => (typeof ir === 'string' ? ir : ir.name) === resident);
                                      return (
                                        <button
                                          key={resident}
                                          style={{
                                            background: isSelected ? '#00313c' : '#E9F2F4',
                                            color: isSelected ? '#fff' : '#222',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'flex-start',
                                            gap: 4,
                                            padding: '12px 16px',
                                            borderRadius: 12,
                                            border: '1px solid rgba(2, 48, 59, 0.04)',
                                            cursor: 'pointer',
                                            fontSize: 15,
                                            fontWeight: 500,
                                            textAlign: 'left',
                                            width: '100%',
                                            userSelect: 'none',
                                            WebkitUserSelect: 'none'
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isSelected) return; // Prevent removal

                                            // Add Logic
                                            const newHistory = [...history];
                                            const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                                            if (histIdx !== -1) {
                                              const currentResidents = newHistory[histIdx].residents || [];
                                              newHistory[histIdx].residents = [resident, ...currentResidents];
                                              setHistory(newHistory);
                                            }

                                            // Move to top logic
                                            setResidents(prev => {
                                              const filtered = prev.filter(r => r !== resident);
                                              return [resident, ...filtered];
                                            });

                                            // Search Exit Logic
                                            if (cardIsSearching) {
                                              setCardIsSearching(false);
                                              setCardSearchQuery('');
                                            }
                                          }}
                                        >
                                          <span style={{
                                            boxSizing: 'border-box',
                                            width: 16,
                                            height: 16,
                                            border: isSelected ? '2px solid #fff' : '1px solid rgba(2, 48, 59, 0.4)',
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0
                                          }}>
                                            {isSelected && (
                                              <span style={{
                                                width: 8,
                                                height: 8,
                                                background: '#fff',
                                                borderRadius: '50%'
                                              }} />
                                            )}
                                          </span>
                                          {resident}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </>,
                              document.body
                            )}

                            {/* Residents tags */}
                            {item.residents && item.residents.length > 0 && item.residents
                              .filter((resident: any) => {
                                const residentName = typeof resident === 'string' ? resident : resident.name;
                                return residentName && residentName.trim() !== '';
                              })
                              .map((resident: any) => {
                                const residentName = typeof resident === 'string' ? resident : resident.name;
                                return (
                                  <span
                                    key={residentName}
                                    style={{
                                      background: '#E9F2F4',
                                      color: '#00313c',
                                      padding: '4px 12px',
                                      borderRadius: 12,
                                      fontSize: 12,
                                      fontWeight: 500,
                                      whiteSpace: 'nowrap',
                                      flexShrink: 0
                                    }}
                                  >
                                    {residentName}
                                  </span>
                                );
                              })}
                          </div>
                          <div className="activity-card-title" style={{ cursor: 'pointer', textDecoration: isDeleted ? 'line-through' : undefined }} onClick={() => { setEditingHistory({ date: 'today', idx }); setEditingName(item.name); }}>{item.name}</div>
                        </>
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
                {items.map((item, idx) => {
                  const cardId = `${date}-${idx}`;
                  const currentOffset = swipeState.cardId === cardId ? swipeState.offset : 0;
                  const isDeleted = item.deleted;
                  return (
                    <div
                      key={item.startAt.getTime()}
                      style={{
                        position: 'relative',
                        overflow: 'hidden',
                        marginBottom: 12,
                        borderRadius: 16
                      }}
                    >
                      {/* 背景操作按钮区域 - 固定在右侧，与卡片10px间距 */}
                      <div style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: SWIPE_ACTION_WIDTH - 10,
                        marginRight: 0,
                        display: 'flex',
                        alignItems: 'stretch',
                        justifyContent: 'center',
                        background: isDeleted ? '#00b96b' : '#d70015',
                        borderRadius: 16,
                        opacity: Math.min(1, Math.abs(currentOffset) / 20),
                        visibility: currentOffset === 0 ? 'hidden' : 'visible',
                        transition: swipeState.isDragging ? 'none' : 'opacity 0.2s ease'
                      }}>
                        <button
                          style={{
                            background: 'transparent',
                            color: '#fff',
                            border: 'none',
                            padding: '8px 16px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '100%',
                            height: '100%',
                            opacity: Math.min(1, Math.abs(currentOffset) / 40)
                          }}
                          onClick={() => {
                            const newHistory = [...history];
                            const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                            if (histIdx !== -1) {
                              newHistory[histIdx].deleted = !isDeleted;
                              setHistory(newHistory);
                            }
                            closeSwipe();
                          }}
                        >
                          {isDeleted ? 'Recover' : 'Delete'}
                        </button>
                      </div>

                      {/* 可滑动的卡片内容 */}
                      <div
                        className="activity-card-history"
                        style={{
                          position: 'relative',
                          opacity: isDeleted ? 0.6 : 1,
                          userSelect: 'none',
                          touchAction: 'pan-y',
                          transform: `translateX(${currentOffset}px)`,
                          transition: swipeState.isDragging ? 'none' : 'transform 0.3s ease',
                          willChange: 'transform',
                          marginBottom: 0 // 覆盖CSS的margin，让按钮高度与卡片一致
                        }}
                        onTouchStart={(e) => handleSwipeTouchStart(e, cardId)}
                        onTouchMove={(e) => handleSwipeTouchMove(e, cardId)}
                        onTouchEnd={() => handleSwipeTouchEnd(cardId)}
                      >
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
                          <>
                            {/* Residents 横向滚动显示 - 在 title 上方，带 add 按钮 */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              marginBottom: 4,
                              overflowX: 'auto',
                              scrollbarWidth: 'none',
                              msOverflowStyle: 'none'
                            }}>
                              {/* Add resident 按钮 */}
                              <button
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  border: '1px dashed #ccc',
                                  background: '#fff',
                                  cursor: 'pointer',
                                  padding: 0,
                                  flexShrink: 0,
                                  position: 'relative'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (showCardResidentDropdown === `${date}-${idx}`) {
                                    setShowCardResidentDropdown(null);
                                    setCardDropdownPosition(null);
                                  } else {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    const MENU_HEIGHT = 320;
                                    const viewportHeight = window.innerHeight;
                                    if (rect.bottom + MENU_HEIGHT > viewportHeight) {
                                      // Place above
                                      setCardDropdownPosition({ bottom: viewportHeight - rect.top + 4, left: rect.left });
                                    } else {
                                      // Place below
                                      setCardDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                                    }
                                    setShowCardResidentDropdown(`${date}-${idx}`);
                                  }
                                  setIsAddingNewCardResident(false);
                                  setCardNewResidentName('');
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                                  <path d="M7 1V13M1 7H13" stroke="#666" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              </button>

                              {/* Dropdown menu - 使用 Portal 渲染到顶层 */}
                              {showCardResidentDropdown === `${date}-${idx}` && cardDropdownPosition && createPortal(
                                <>
                                  {/* 全屏透明遮罩 */}
                                  <div
                                    style={{
                                      position: 'fixed',
                                      inset: 0,
                                      zIndex: 999998,
                                      background: 'transparent',
                                      touchAction: 'none'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowCardResidentDropdown(null);
                                      setCardNewResidentName('');
                                      setIsAddingNewCardResident(false);
                                      setCardIsSearching(false);
                                      setCardSearchQuery('');
                                    }}
                                    onTouchMove={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }}
                                  />

                                  {/* 菜单内容 */}
                                  <div
                                    data-card-resident-dropdown
                                    style={{
                                      position: 'fixed',
                                      top: cardDropdownPosition.top,
                                      bottom: cardDropdownPosition.bottom,
                                      left: 48,
                                      right: 48,
                                      width: 'auto',
                                      background: '#fff',
                                      borderRadius: 16,
                                      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                                      padding: '20px 24px',
                                      maxHeight: 300,
                                      overflowY: 'auto',
                                      zIndex: 999999,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      overscrollBehavior: 'contain'
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    onTouchMove={e => e.stopPropagation()}
                                  >
                                    {/* 标题栏 */}
                                    <div style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      marginBottom: 12
                                    }}>
                                      <div style={{
                                        fontSize: 12,
                                        fontWeight: 400,
                                        color: '#666',
                                        textTransform: 'uppercase',
                                        letterSpacing: 0.5
                                      }}>
                                        Resident
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        {/* Search Button */}
                                        {!isAddingNewCardResident && !cardIsSearching && (
                                          <button
                                            style={{
                                              width: 24,
                                              height: 24,
                                              border: 'none',
                                              background: 'transparent',
                                              cursor: 'pointer',
                                              padding: 0,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center'
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setCardIsSearching(true);
                                              setIsAddingNewCardResident(false);
                                            }}
                                          >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(2, 48, 59, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                          </button>
                                        )}
                                        {/* Add Button */}
                                        {!cardIsSearching && !isAddingNewCardResident && (
                                          <button
                                            style={{
                                              width: 24,
                                              height: 24,
                                              border: 'none',
                                              background: 'transparent',
                                              cursor: 'pointer',
                                              padding: 0,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center'
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setIsAddingNewCardResident(true);
                                              setCardIsSearching(false);
                                            }}
                                          >
                                            <svg width="24" height="24" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                              <path d="M10.0004 1.90845C14.469 1.9088 18.0921 5.53156 18.0921 10.0002C18.0918 14.4686 14.4687 18.0917 10.0004 18.092C5.53166 18.092 1.90891 14.4688 1.90855 10.0002C1.90855 5.53134 5.53145 1.90845 10.0004 1.90845ZM10.0004 3.50806C6.4151 3.50806 3.50816 6.415 3.50816 10.0002C3.50852 13.5852 6.41532 16.4915 10.0004 16.4915C13.5851 16.4911 16.4912 13.585 16.4916 10.0002C16.4916 6.41521 13.5853 3.50841 10.0004 3.50806ZM10.7992 9.19946H13.6459V10.7991H10.7992V13.6458H9.19957V10.7991H6.35387V9.19946H9.19957V6.35376H10.7992V9.19946Z" fill="rgba(2, 48, 59, 0.85)" />
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Shared Input Area */}
                                    {(cardIsSearching || isAddingNewCardResident) && (
                                      <div style={{ marginBottom: 12 }}>
                                        <input
                                          style={{
                                            width: '100%',
                                            height: '44px',
                                            padding: '0 16px',
                                            border: '1px solid #00313c',
                                            borderRadius: '12px',
                                            fontSize: '16px',
                                            fontWeight: '500',
                                            outline: 'none',
                                            boxSizing: 'border-box',
                                            background: '#f5f9fa',
                                            color: '#222'
                                          }}
                                          placeholder={cardIsSearching ? "Search resident..." : "Enter resident name"}
                                          value={cardIsSearching ? cardSearchQuery : cardNewResidentName}
                                          autoFocus
                                          onChange={e => {
                                            if (cardIsSearching) {
                                              setCardSearchQuery(e.target.value);
                                            } else {
                                              setCardNewResidentName(e.target.value);
                                            }
                                          }}
                                          onBlur={() => {
                                            if (cardIsSearching && !cardSearchQuery) setCardIsSearching(false);
                                            if (isAddingNewCardResident && !cardNewResidentName) setIsAddingNewCardResident(false);
                                          }}
                                          onKeyDown={e => {
                                            if (e.key === 'Escape') {
                                              if (cardIsSearching) {
                                                setCardSearchQuery('');
                                                setCardIsSearching(false);
                                              } else {
                                                setCardNewResidentName('');
                                                setIsAddingNewCardResident(false);
                                              }
                                            } else if (e.key === 'Enter') {
                                              if (isAddingNewCardResident && cardNewResidentName.trim()) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const newName = cardNewResidentName.trim();
                                                // Deduplicate logic
                                                setResidents(prev => {
                                                  const filtered = prev.filter(r => r !== newName);
                                                  return [newName, ...filtered];
                                                });

                                                // Update history item
                                                const newHistory = [...history];
                                                const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                                                if (histIdx !== -1) {
                                                  const currentResidents = newHistory[histIdx].residents || [];
                                                  const residentNames = currentResidents.map((r: any) => typeof r === 'string' ? r : r.name);
                                                  if (!residentNames.includes(newName)) {
                                                    newHistory[histIdx].residents = [newName, ...currentResidents];
                                                    setHistory(newHistory);
                                                  }
                                                }
                                                setCardNewResidentName('');
                                                setIsAddingNewCardResident(false);
                                              }
                                            }
                                          }}
                                          onClick={e => e.stopPropagation()}
                                        />
                                      </div>
                                    )}

                                    {/* List */}
                                    <div style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 12
                                    }}>
                                      {residents.filter(r => !cardIsSearching || r.toLowerCase().includes(cardSearchQuery.toLowerCase())).map(resident => {
                                        const itemResidents = item.residents || [];
                                        const isSelected = itemResidents.some((ir: any) => (typeof ir === 'string' ? ir : ir.name) === resident);
                                        return (
                                          <button
                                            key={resident}
                                            style={{
                                              background: isSelected ? '#00313c' : '#E9F2F4',
                                              color: isSelected ? '#fff' : '#222',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'flex-start',
                                              gap: 4,
                                              padding: '12px 16px',
                                              borderRadius: 12,
                                              border: '1px solid rgba(2, 48, 59, 0.04)',
                                              cursor: 'pointer',
                                              fontSize: 15,
                                              fontWeight: 500,
                                              textAlign: 'left',
                                              width: '100%',
                                              userSelect: 'none',
                                              WebkitUserSelect: 'none'
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const newHistory = [...history];
                                              const histIdx = history.findIndex(h => h.endAt === item.endAt && h.startAt === item.startAt);
                                              if (histIdx !== -1) {
                                                const currentResidents = newHistory[histIdx].residents || [];
                                                if (isSelected) {
                                                  newHistory[histIdx].residents = currentResidents.filter((r: any) => {
                                                    const name = typeof r === 'string' ? r : r.name;
                                                    return name !== resident;
                                                  });
                                                } else {
                                                  newHistory[histIdx].residents = [resident, ...currentResidents];
                                                }
                                                setHistory(newHistory);
                                              }

                                              // Search Exit Logic
                                              if (cardIsSearching) {
                                                setCardIsSearching(false);
                                                setCardSearchQuery('');
                                              }
                                            }}
                                          >
                                            <span style={{
                                              boxSizing: 'border-box',
                                              width: 16,
                                              height: 16,
                                              border: isSelected ? '2px solid #fff' : '1px solid rgba(2, 48, 59, 0.4)',
                                              borderRadius: '50%',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              flexShrink: 0
                                            }}>
                                              {isSelected && (
                                                <span style={{
                                                  width: 8,
                                                  height: 8,
                                                  background: '#fff',
                                                  borderRadius: '50%'
                                                }} />
                                              )}
                                            </span>
                                            {resident}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </>,
                                document.body
                              )}

                              {/* Residents tags */}
                              {item.residents && item.residents.length > 0 && item.residents
                                .filter((resident: any) => {
                                  const residentName = typeof resident === 'string' ? resident : resident.name;
                                  return residentName && residentName.trim() !== '';
                                })
                                .map((resident: any) => {
                                  const residentName = typeof resident === 'string' ? resident : resident.name;
                                  return (
                                    <span
                                      key={residentName}
                                      style={{
                                        background: '#E9F2F4',
                                        color: '#00313c',
                                        padding: '4px 12px',
                                        borderRadius: 12,
                                        fontSize: 12,
                                        fontWeight: 500,
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0
                                      }}
                                    >
                                      {residentName}
                                    </span>
                                  );
                                })}
                            </div>
                            <div className="activity-card-title" style={{ cursor: 'pointer', textDecoration: isDeleted ? 'line-through' : undefined }} onClick={() => { setEditingHistory({ date, idx }); setEditingName(item.name); }}>{item.name}</div>
                          </>
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
          {/* iOS风格半透明遮罩层 - 全局覆盖包括标题区域 */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999, // 高于header的200，覆盖整个页面
              background: showBottomSheet ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0)',
              transition: 'background 0.3s ease',
              touchAction: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isBottomSheetClosing) {
                setIsBottomSheetClosing(true);
                setShowStartButton(false);
                setTimeout(() => {
                  setShowBottomSheet(false);
                  setEditingRecentActivity(null);
                  setEditingRecentName('');
                  setIsBottomSheetClosing(false);
                  setPopupRendered(false);
                  setIsResidentSearching(false);
                  setResidentSearchQuery('');
                  setIsAddingResident(false);
                  setNewResidentName('');
                  setTimeout(() => {
                    setShowStartButton(true);
                  }, 100);
                }, 450);
              }
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchMove={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
          <div
            className="activity-bottom-sheet-fixed"
            style={{
              zIndex: 1000,
              position: 'fixed',
              left: '50%',
              bottom: 0,
              transform: 'translateX(-50%)',
              maxHeight: 'calc(100vh - 120px)',
              height: 'auto',
              animation: isBottomSheetClosing
                ? 'slideDownToBottom 450ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
                : 'slideUpFromBottom 450ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              overscrollBehavior: 'contain',
              touchAction: 'pan-y'
            }}
            onClick={(e) => {
              // 阻止点击事件冒泡到遮罩层，防止意外关闭
              e.stopPropagation();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchMove={(e) => {
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
            }}
          >
            {/* 半屏标题栏 - 匹配Summary样式 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '24px 24px 16px 24px',
              boxSizing: 'border-box',
              background: '#fff',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              position: 'sticky',
              top: 0,
              zIndex: 10
            }}>
              <div style={{ fontWeight: 700, fontSize: 20, color: '#222' }}>Start Activity</div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isBottomSheetClosing) {
                    setIsBottomSheetClosing(true);
                    setShowStartButton(false);
                    setTimeout(() => {
                      setShowBottomSheet(false);
                      setEditingRecentActivity(null);
                      setEditingRecentName('');
                      setIsBottomSheetClosing(false);
                      setPopupRendered(false);
                      setIsResidentSearching(false);
                      setResidentSearchQuery('');
                      setIsAddingResident(false);
                      setNewResidentName('');
                      setTimeout(() => {
                        setShowStartButton(true);
                      }, 100);
                    }, 450);
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
                  padding: 0
                }}
              >
                <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14.158 5.27173L9.98804 9.44165L14.158 13.6116L13.3103 14.4592L9.14038 10.2893L4.97046 14.4592L4.1228 13.6116L8.29272 9.44165L4.1228 5.27173L4.97046 4.42407L9.14038 8.59399L13.3103 4.42407L14.158 5.27173Z" fill="black" fillOpacity="0.85" />
                </svg>
              </button>
            </div>
            <div
              className="activity-popup-inner"
              style={{
                padding: '0 24px',
                paddingTop: 0, // 标题区已有padding，无需额外间距
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflowY: 'auto',
                overscrollBehavior: 'contain'
              }}
              onScroll={(e) => {
                e.stopPropagation();
              }}
              onTouchMove={(e) => {
                e.stopPropagation();
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onFocus={(e) => {
                e.stopPropagation();
              }}
              onBlur={(e) => {
                e.stopPropagation();
              }}
            >
              {/* RESIDENT Section */}
              <div style={{ marginBottom: 28, marginTop: 28 }}>
                {/* 标题栏 - 包含 Resident 标题和添加按钮 */}
                {/* 标题栏 - 包含 Resident 标题和操作按钮 */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12
                }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 400,
                    color: '#666',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5
                  }}>
                    Resident
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* 搜索按钮 - 仅在有 residents 且未添加/搜索时显示 */}
                    {residents.length > 0 && !isAddingResident && !isResidentSearching && (
                      <button
                        style={{
                          width: 24,
                          height: 24,
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsResidentSearching(true);
                          setIsAddingResident(false);
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(2, 48, 59, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                      </button>
                    )}
                    {/* Add button */}
                    {residents.length > 0 && !isAddingResident && !isResidentSearching && (
                      <button
                        style={{
                          width: 24,
                          height: 24,
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const popupContainer = document.querySelector('.activity-bottom-sheet-fixed');
                          if (popupContainer) {
                            popupContainer.setAttribute('data-recent-interaction', 'true');
                            setTimeout(() => {
                              popupContainer.removeAttribute('data-recent-interaction');
                            }, 1000);
                          }
                          setIsAddingResident(true);
                          setIsResidentSearching(false);
                        }}
                      >
                        <svg width="24" height="24" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10.0004 1.90845C14.469 1.9088 18.0921 5.53156 18.0921 10.0002C18.0918 14.4686 14.4687 18.0917 10.0004 18.092C5.53166 18.092 1.90891 14.4688 1.90855 10.0002C1.90855 5.53134 5.53145 1.90845 10.0004 1.90845ZM10.0004 3.50806C6.4151 3.50806 3.50816 6.415 3.50816 10.0002C3.50852 13.5852 6.41532 16.4915 10.0004 16.4915C13.5851 16.4911 16.4912 13.585 16.4916 10.0002C16.4916 6.41521 13.5853 3.50841 10.0004 3.50806ZM10.7992 9.19946H13.6459V10.7991H10.7992V13.6458H9.19957V10.7991H6.35387V9.19946H9.19957V6.35376H10.7992V9.19946Z" fill="rgba(2, 48, 59, 0.85)" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Shared Search/Add Input */}
                {(isResidentSearching || isAddingResident) && (
                  <input
                    style={{
                      width: '100%',
                      height: '44px',
                      padding: '0 16px',
                      border: '1px solid #00313c',
                      borderRadius: '12px',
                      fontSize: '16px',
                      fontWeight: '500',
                      outline: 'none',
                      boxSizing: 'border-box',
                      background: '#f5f9fa',
                      marginBottom: 12,
                      color: '#222'
                    }}
                    placeholder={isResidentSearching ? "Search resident..." : "Enter resident name"}
                    value={isResidentSearching ? residentSearchQuery : newResidentName}
                    enterKeyHint="done"
                    autoComplete="off"
                    autoFocus
                    onChange={e => {
                      if (isResidentSearching) {
                        setResidentSearchQuery(e.target.value);
                      } else {
                        setNewResidentName(e.target.value);
                      }
                    }}
                    onFocus={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onBlur={(e) => {
                      e.stopPropagation();
                      if (isResidentSearching && !residentSearchQuery) {
                        setIsResidentSearching(false);
                      }
                      if (isAddingResident) {
                        if (newResidentName.trim()) {
                          setResidents(prev => {
                            const name = newResidentName.trim();
                            const filtered = prev.filter(r => r !== name);
                            return [name, ...filtered];
                          });
                        }
                        setNewResidentName('');
                        setIsAddingResident(false);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.blur();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isResidentSearching) {
                          setResidentSearchQuery('');
                          setIsResidentSearching(false);
                        } else {
                          setNewResidentName('');
                          setIsAddingResident(false);
                        }
                      }
                    }}
                  />
                )}

                {/* Resident 名字区域 - 横向滚动，最多2行 */}
                {residents.length > 0 ? (
                  <div style={{
                    overflowX: 'auto',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch'
                  }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateRows: 'repeat(2, 1fr)',
                      gridAutoFlow: 'column',
                      gridAutoColumns: 'max-content',
                      columnGap: 12,
                      rowGap: 12,
                      padding: 4, // 防止input被截断
                      paddingBottom: 4
                    }}>
                      {residents.filter(r => !isResidentSearching || r.toLowerCase().includes(residentSearchQuery.toLowerCase())).map(resident => (
                        editingResident === resident ? (
                          <div key={resident} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              style={{
                                height: '44px',
                                padding: '0 16px',
                                border: '1px solid #00313c',
                                borderRadius: 12,
                                fontSize: 16,
                                fontWeight: 500,
                                outline: 'none',
                                boxSizing: 'border-box',
                                background: '#f5f9fa',
                                color: '#222',
                                width: Math.max(100, editingResidentName.length * 10 + 32) + 'px',
                                maxWidth: '160px',
                                flex: '0 0 auto'
                              }}
                              enterKeyHint="done"
                              autoComplete="off"
                              value={editingResidentName}
                              autoFocus
                              onClick={e => e.stopPropagation()}
                              onFocus={e => e.stopPropagation()}
                              onChange={e => setEditingResidentName(e.target.value)}
                              onBlur={(e) => {
                                e.stopPropagation();
                                const newName = editingResidentName.trim();
                                if (newName === '') {
                                  setEditingResident(null);
                                } else if (newName !== resident) {
                                  setResidents(prev => {
                                    const filtered = prev.filter(r => r !== newName);
                                    return filtered.map(r => r === resident ? newName : r);
                                  });
                                  setSelectedResidents(prev => {
                                    const wasSelected = prev.includes(resident);
                                    const newNameWasSelected = prev.includes(newName);
                                    let newSelected = prev.filter(r => r !== resident && r !== newName);
                                    if (wasSelected || newNameWasSelected) {
                                      newSelected.push(newName);
                                    }
                                    return newSelected;
                                  });
                                  setEditingResident(null);
                                } else {
                                  setEditingResident(null);
                                }
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEditingResidentName(resident);
                                  setEditingResident(null);
                                }
                              }}
                            />
                            <button
                              style={{
                                width: 28,
                                height: 28,
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                setResidents(prev => prev.filter(r => r !== resident));
                                setSelectedResidents(prev => prev.filter(r => r !== resident));
                                setEditingResident(null);
                              }}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cc3333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            key={resident}
                            style={{
                              background: selectedResidents.includes(resident) ? '#00313c' : '#E9F2F4',
                              color: selectedResidents.includes(resident) ? '#fff' : '#222',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              gap: 4,
                              padding: '12px 16px',
                              borderRadius: 12,
                              border: '1px solid rgba(2, 48, 59, 0.04)',
                              cursor: 'pointer',
                              fontSize: 15,
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              minWidth: 'fit-content',
                              // 禁止文本选中，优化长按体验
                              userSelect: 'none',
                              WebkitUserSelect: 'none',
                              touchAction: 'manipulation'
                            }}
                            onTouchStart={(e) => {
                              const touch = e.touches[0];
                              (window as any).__residentTouchStartX = touch.clientX;
                              (window as any).__residentTouchStartY = touch.clientY;
                              (window as any).__residentTouchStartTime = Date.now();
                              if ((window as any).__residentLongPressTimer) clearTimeout((window as any).__residentLongPressTimer);
                              (window as any).__residentLongPressFired = false;
                              (window as any).__residentTouchHandled = false;
                              (window as any).__residentIsSwiping = false;
                              (window as any).__residentLongPressTimer = setTimeout(() => {
                                (window as any).__residentLongPressFired = true;
                                (window as any).__residentTouchHandled = true;
                                setEditingResident(resident);
                                setEditingResidentName(resident);
                                // 震动反馈
                                if (navigator.vibrate) navigator.vibrate(50);
                              }, 300); // 缩短到300ms提高灵敏度
                            }}
                            onTouchMove={(e) => {
                              const touch = e.touches[0];
                              const startX = (window as any).__residentTouchStartX || 0;
                              const startY = (window as any).__residentTouchStartY || 0;
                              const moveX = Math.abs(touch.clientX - startX);
                              const moveY = Math.abs(touch.clientY - startY);
                              // 移动超过10px视为滑动
                              if (moveX > 10 || moveY > 10) {
                                (window as any).__residentIsSwiping = true;
                                if ((window as any).__residentLongPressTimer) clearTimeout((window as any).__residentLongPressTimer);
                              }
                            }}
                            onTouchEnd={() => {
                              if ((window as any).__residentLongPressTimer) clearTimeout((window as any).__residentLongPressTimer);
                              const elapsed = Date.now() - ((window as any).__residentTouchStartTime || 0);
                              // 只有在非滑动且非长按且时间<300ms时才视为点击
                              if (!(window as any).__residentLongPressFired &&
                                !(window as any).__residentTouchHandled &&
                                !(window as any).__residentIsSwiping &&
                                elapsed < 300) {
                                (window as any).__residentTouchHandled = true;
                                setSelectedResidents(prev =>
                                  prev.includes(resident)
                                    ? prev.filter(r => r !== resident)
                                    : [...prev, resident]
                                );

                                // Search Exit Logic
                                if (isResidentSearching) {
                                  setIsResidentSearching(false);
                                  setResidentSearchQuery('');
                                }
                              }
                            }}
                            onMouseDown={() => {
                              // 只在非触摸设备上处理
                              if ((window as any).__residentTouchHandled) return;
                              if ((window as any).__residentLongPressTimer) clearTimeout((window as any).__residentLongPressTimer);
                              (window as any).__residentLongPressFired = false;
                              (window as any).__residentLongPressTimer = setTimeout(() => {
                                (window as any).__residentLongPressFired = true;
                                setEditingResident(resident);
                                setEditingResidentName(resident);
                              }, 800);
                            }}
                            onMouseUp={() => {
                              if ((window as any).__residentLongPressTimer) clearTimeout((window as any).__residentLongPressTimer);
                            }}
                            onMouseLeave={() => {
                              if ((window as any).__residentLongPressTimer) clearTimeout((window as any).__residentLongPressTimer);
                            }}
                            onClick={e => {
                              // 如果是触摸设备且已处理，跳过 click 事件
                              if ((window as any).__residentTouchHandled) {
                                (window as any).__residentTouchHandled = false;
                                return;
                              }
                              // 桌面端：只有在没有触发长按的情况下才执行点击操作
                              if (!(window as any).__residentLongPressFired) {
                                e.stopPropagation();
                                setSelectedResidents(prev =>
                                  prev.includes(resident)
                                    ? prev.filter(r => r !== resident)
                                    : [...prev, resident]
                                );

                                // Search Exit Logic
                                if (isResidentSearching) {
                                  setIsResidentSearching(false);
                                  setResidentSearchQuery('');
                                }
                              }
                            }}
                          >
                            <span style={{
                              boxSizing: 'border-box',
                              width: 16,
                              height: 16,
                              border: selectedResidents.includes(resident) ? '2px solid #fff' : '1px solid rgba(2, 48, 59, 0.4)',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              {selectedResidents.includes(resident) && (
                                <span style={{
                                  width: 8,
                                  height: 8,
                                  background: '#fff',
                                  borderRadius: '50%'
                                }} />
                              )}
                            </span>
                            {resident}
                          </button>
                        )
                      ))}
                    </div>
                  </div>
                ) : !isAddingResident && (
                  /* 没有 residents 时显示 Add Name 按钮 */
                  <Button
                    block
                    className="activity-btn"
                    shape="rounded"
                    size="large"
                    style={{
                      border: '1px dashed #ccc',
                      background: '#fff'
                    }}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      // 设置交互标记，防止popup被关闭
                      const popupContainer = document.querySelector('.activity-bottom-sheet-fixed');
                      if (popupContainer) {
                        popupContainer.setAttribute('data-recent-interaction', 'true');
                        setTimeout(() => {
                          popupContainer.removeAttribute('data-recent-interaction');
                        }, 1000);
                      }
                      setIsAddingResident(true);
                    }}
                  >
                    + Add Name
                  </Button>
                )}
              </div>

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
                  <div style={{ marginBottom: 28 }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 400,
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, overflow: 'hidden' }}>
                              <input
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  height: '48px',
                                  padding: '0 12px',
                                  border: '1px solid #00313c',
                                  borderRadius: '12px',
                                  fontSize: 16,
                                  fontWeight: 500,
                                  outline: 'none',
                                  boxSizing: 'border-box',
                                  background: '#f5f9fa',
                                  color: '#222'
                                }}
                                enterKeyHint="done"
                                value={editingRecentName}
                                autoFocus
                                onChange={e => setEditingRecentName(e.target.value)}
                                onBlur={() => {
                                  if (editingRecentName.trim() === '') {
                                    setEditingRecentName(activity);
                                    setEditingRecentActivity(null);
                                  } else {
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
                                      setEditingRecentName(activity);
                                      setEditingRecentActivity(null);
                                    } else {
                                      setRecentActivities(prev =>
                                        prev.map(item =>
                                          item === activity ? editingRecentName : item
                                        )
                                      );
                                      setEditingRecentActivity(null);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setEditingRecentName(activity);
                                    setEditingRecentActivity(null);
                                  }
                                }}
                              />
                              <button
                                style={{
                                  width: 28,
                                  height: 28,
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  padding: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => {
                                  setRecentActivities(prev => prev.filter(item => item !== activity));
                                  setEditingRecentActivity(null);
                                }}
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cc3333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                              </button>
                            </div>
                          ) : (
                            <div
                              onTouchStart={e => {
                                e.preventDefault();
                                if ((window as any).__recentLongPressTimer) clearTimeout((window as any).__recentLongPressTimer);
                                (window as any).__recentRecentLongPressFired = false;
                                (window as any).__recentLongPressTimer = setTimeout(() => {
                                  (window as any).__recentRecentLongPressFired = true;
                                  setEditingRecentActivity(activity);
                                  setEditingRecentName(activity);
                                }, 1000);
                              }}
                              onTouchEnd={() => {
                                if ((window as any).__recentLongPressTimer) clearTimeout((window as any).__recentLongPressTimer);
                              }}
                              onTouchMove={() => {
                                if ((window as any).__recentLongPressTimer) clearTimeout((window as any).__recentLongPressTimer);
                              }}
                              onMouseDown={() => {
                                if ((window as any).__recentLongPressTimer) clearTimeout((window as any).__recentLongPressTimer);
                                (window as any).__recentRecentLongPressFired = false;
                                (window as any).__recentLongPressTimer = setTimeout(() => {
                                  (window as any).__recentRecentLongPressFired = true;
                                  setEditingRecentActivity(activity);
                                  setEditingRecentName(activity);
                                }, 1000);
                              }}
                              onMouseUp={() => {
                                if ((window as any).__recentLongPressTimer) clearTimeout((window as any).__recentLongPressTimer);
                              }}
                              onMouseLeave={() => {
                                if ((window as any).__recentLongPressTimer) clearTimeout((window as any).__recentLongPressTimer);
                              }}
                              onClick={() => {
                                if ((window as any).__recentRecentLongPressFired) {
                                  // 长按已触发编辑，不再触发点击
                                  (window as any).__recentRecentLongPressFired = false;
                                  return;
                                }
                                startActivity(activity);
                              }}
                              onContextMenu={e => e.preventDefault()}
                            >
                              <Button
                                block
                                className="activity-btn"
                                shape="rounded"
                                size="large"
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
                <div style={{ marginBottom: 28 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 400,
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
                borderTop: '1px solid #f0f0f0',
                display: 'flex',
                gap: 10,
                alignItems: 'center'
              }}>
                <input
                  ref={(el) => {
                    // 保存引用到 window 以便在 blur() 时使用
                    (window as any).__activityNameInput = el;
                  }}
                  className="activity-input"
                  placeholder="Write Activity Name"
                  value={activityName}
                  onChange={(e) => setActivityName(e.target.value)}
                  style={{
                    flex: 1,
                    height: '44px',
                    padding: '0 16px',
                    border: '1px solid #ddd',
                    borderRadius: '12px',
                    fontSize: '16px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    background: '#f8f8f8',
                    color: '#222' // 确保深色文字
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onBlur={(e) => {
                    e.stopPropagation();
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.blur();
                    }
                  }}
                  enterKeyHint="done"
                  autoComplete="off"
                />
                <Button className="activity-btn ant-btn-primary" shape="rounded" onClick={() => startActivity(activityName)} disabled={!activityName} style={{ height: '44px' }}>Start</Button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* ✨ Start Activity 按钮 - popup关闭时显示 */}
      {
        !showBottomSheet && !isBottomSheetClosing && showStartButton && !showStatsModal && !isStatsModalClosing && (
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
        )
      }
    </div>
  );
}

export default App;
