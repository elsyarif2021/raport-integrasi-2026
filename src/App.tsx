import { getSession, getStudents, logout, saveChanges, importLegacyZip, previewLoginLink, getLinkedSession, previewPinLink, getPinLinkedSession, RaportApiError, type LoginLinkPreview, type StudentChange } from './services/raportApi';
import { readLoginLinkToken, readPinLinkSlug } from './utils/loginLink';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { INITIAL_SUBJECTS, INITIAL_SCHOOL_CONFIG, INITIAL_CLASSES, INITIAL_FULLDAY_CONFIG } from './data/initialData';
import { Subject, StudentRecord, CalculatedStudent, SchoolConfig, ClassItem, AuthUser, JenjangUnit, SchoolType } from './types';
import { ReportCertificate } from './components/ReportCertificate';
import { SidebarControls } from './components/SidebarControls';
import { AppShell, type WorkspaceView } from './components/AppShell';
import { RekapitulasiTable } from './components/RekapitulasiTable';
import { TeacherGradingView } from './components/TeacherGradingView';
import { DataMasterView } from './components/DataMasterView';
import { StudentModal } from './components/StudentModal';
import { SettingsModal } from './components/SettingsModal';
import { BatchPrintView } from './components/BatchPrintView';
import { ReportDesignModal } from './components/ReportDesignModal';
import { MuatanMataPelajaranView } from './components/MuatanMataPelajaranView';
import { TeacherDatabaseView } from './components/TeacherDatabaseView';
import { SikapView } from './components/SikapView';
import { LoginView } from './components/LoginView';
import { ChangePinView } from './components/ChangePinView';
import { AccountAccessModal } from './components/AccountAccessModal';
import { getSubjectsForClass, ensureStudentScoresForClass, MASTER_SUBJECTS_CATALOG } from './data/curriculumSubjects';
import { getWaliKelasForClass } from './data/waliKelasDatabase';
import { canUserEditSubject, getJenjangForClass } from './utils/authHelpers';
import { canManageClass, selectWorkspaceClasses } from './utils/workspaceAccess';
import { exportRaportToPdf } from './utils/exportHelpers';
import { ReportDesignConfig, DEFAULT_DESIGN_CONFIG, getSavedDesignConfig, saveDesignConfig } from './data/reportDesign';
import { ExcelTableToolbar, SelectedColumnKey } from './components/ExcelTableToolbar';
import {
  FileText,
  FileSpreadsheet,
  Plus,
  Sliders,
  RotateCcw,
  PenTool,
  Users,
  BookOpen,
  GraduationCap,
  LogOut,
  ShieldCheck,
  UserCheck,
  Lock,
  School,
  Palette,
} from 'lucide-react';

const STORAGE_KEY_CONFIG = 'kasyfud_darajat_config_smp_v4';
const STORAGE_KEY_CLASSES = 'kasyfud_darajat_classes_smp_v4';
const STORAGE_KEY_OVERRIDES = 'kasyfud_darajat_overrides_v1';
const STORAGE_KEY_CLASS_SUBJECTS = 'kasyfud_darajat_class_subjects_v1';

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loginNotice,setLoginNotice]=useState('');
  const [linkToken, setLinkToken] = useState(() => readLoginLinkToken(window.location.hash));
  const [pinSlug, setPinSlug] = useState(() => readPinLinkSlug(window.location.hash));
  const [personalLink, setPersonalLink] = useState<LoginLinkPreview | null>(null);
  const [accountMismatch, setAccountMismatch] = useState(false);
  const [inactiveLink, setInactiveLink] = useState(false);
  const [subjects] = useState<Subject[]>(INITIAL_SUBJECTS);

  const [preferredSchoolType, setSchoolType] = useState<SchoolType>(() => {
    try {
      const saved = localStorage.getItem('kasyfud_darajat_active_school_type');
      if (saved === 'fullday' || saved === 'mukim') return saved;
    } catch {}
    return 'mukim';
  });

  const [preferredJenjang, setActiveJenjang] = useState<JenjangUnit>(() => {
    return 'SMP';
  });
  
  const [classes, setClasses] = useState<ClassItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CLASSES);
      if (saved) {
        const parsed: ClassItem[] = JSON.parse(saved);
        const hasLevel3 = parsed.some((c) => c.id.startsWith('3') && !c.id.startsWith('3int'));
        const hasLevel1Int = parsed.some((c) => c.id === '1int');
        const hasLevel2Int = parsed.some((c) => c.id.startsWith('2int'));
        const hasLevel4 = parsed.some((c) => c.id.startsWith('4') || c.level === '4');
        const hasLevel3Int = parsed.some((c) => c.id.startsWith('3int') || c.level === '3int');
        const hasLevel5 = parsed.some((c) => c.id.startsWith('5') || c.level === '5');
        const hasLevel6 = parsed.some((c) => c.id.startsWith('6') || c.level === '6');
        const has2IntIpa = parsed.some((c) => c.id === '2int-a' && c.nameLatin.includes('IPA'));
        const has3IntIpa = parsed.some((c) => c.id === '3int-a' && c.nameLatin.includes('IPA'));
        const hasFullDayClass = parsed.some((c) => c.schoolType === 'fullday' || (c.id || '').includes('fd'));
        const fullDayCount = parsed.filter((c) => c.schoolType === 'fullday' || (c.id || '').includes('fd')).length;
        const hasOldNmNaming = parsed.some(
          (c) => (c.nameLatin || '').includes('(NM)') || (c.nameLatin || '').includes('Non Mukim')
        );
        const hasVii5 = parsed.some((c) => c.id === 'vii-5-fd-pa');
        if (
          !hasLevel3 ||
          !hasLevel1Int ||
          !hasLevel2Int ||
          !hasLevel4 ||
          !hasLevel3Int ||
          !hasLevel5 ||
          !hasLevel6 ||
          !has2IntIpa ||
          !has3IntIpa ||
          !hasFullDayClass ||
          fullDayCount < 11 ||
          hasOldNmNaming ||
          !hasVii5
        ) {
          return INITIAL_CLASSES;
        }
        return parsed;
      }
    } catch {
      // ignore
    }
    return INITIAL_CLASSES;
  });

  // Active class ID e.g. '1a', '1b', '1d', '1e', '1-int-a', 'x-a-fd'
  const [preferredClassId, setSelectedClassId] = useState<string>('1a');

  // Active subject ID for teacher grading e.g. 's1' (Tamrin Lughoh)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('s1');

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [accessMessage, setAccessMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const pendingChanges = useRef<StudentChange[]>([]);
  const saveInProgress = useRef<Promise<void> | null>(null);

  const flushChanges = () => {
    if (saveInProgress.current) return saveInProgress.current;
    if (!pendingChanges.current.length) return Promise.resolve();
    setIsSaving(true);
    const save = Promise.resolve().then(async () => {
      while (pendingChanges.current.length) {
        const batch = pendingChanges.current.slice(0, 100);
        await saveChanges(batch);
        pendingChanges.current.splice(0, batch.length);
      }
    }).finally(() => {
      saveInProgress.current = null;
      setIsSaving(false);
    });
    saveInProgress.current = save;
    return save;
  };

  const queueChange = (change: StudentChange) => {
    pendingChanges.current.push(change);
    void flushChanges().then(
      () => undefined,
      (error: Error) => {
        pendingChanges.current = [];
        setAccessMessage(error.message + ' Periksa data yang tersimpan sebelum melanjutkan.');
      },
    );
  };

  const [config, setConfig] = useState<SchoolConfig>(() => {
    const defaultWali = getWaliKelasForClass('1a') || 'AMALIA NUR FARHIFA, S.Pd.';
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.waliKelasName || parsed.waliKelasName.includes('Siti Nurhaliza')) {
          parsed.waliKelasName = defaultWali;
        }
        if (!parsed.subTitleAr || parsed.subTitleAr.includes('لتقييم منتصف')) {
          parsed.subTitleAr = 'للامتحان التّحريري لفصل الدّراسي الأوّل';
        }
        if (parsed.subTitleId && (parsed.subTitleId.includes('PENILAIAN') || parsed.subTitleId.includes('SUMATIF'))) {
          parsed.subTitleId = 'ASESMEN TENGAH SEMESTER GANJIL';
        }
        return parsed;
      }
    } catch {
      // ignore
    }
    return {
      ...INITIAL_SCHOOL_CONFIG,
      subTitleAr: 'للامتحان التّحريري لفصل الدّراسي الأوّل',
      classLatin: '1A (Kelas 1 SMP A)',
      classAr: 'الأوّل - A',
      waliKelasName: defaultWali,
    };
  });

  // Active view: 'master' (Data Master) | 'muatan' (Muatan Mapel) | 'databaseGuru' (Database Guru & Mapel) | 'guru' (Input Nilai) | 'raport' (Raport) | 'rekap' (Rekapitulasi)
  const [activeTab, setActiveTab] = useState<WorkspaceView>('master');
  const classSelection = useMemo(() => selectWorkspaceClasses(currentUser, activeTab==='pin'?'guru':activeTab, classes, {
    schoolType: preferredSchoolType, jenjang: preferredJenjang, classId: preferredClassId,
  }), [currentUser, activeTab, classes, preferredSchoolType, preferredJenjang, preferredClassId]);
  const { schoolType, activeJenjang, selectedClassId, filteredClasses: filteredClassesForUser } = classSelection;
  const workspaceStudents = useMemo(() => students.filter(student =>
    classSelection.scopedClasses.some(item => item.id === student.classId)), [students, classSelection.scopedClasses]);

  // Enforce strict role-based view access:
  // - Guru: ONLY 'guru'
  // - Wali Kelas: ONLY 'raport', 'rekap', 'guru'
  // - Admin: All views
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role === 'guru') {
      if (activeTab !== 'guru' && !(activeTab==='pin'&&currentUser.loginMethod==='pin')) {
        setActiveTab('guru');
      }
    } else if (currentUser.role === 'wali_kelas') {
      if (['master', 'muatan', 'databaseGuru', 'settings', 'design', 'accounts'].includes(activeTab)) {
        setActiveTab('raport');
      }
    }
  }, [currentUser, activeTab]);

  // Selected student index within the currently viewed class for Raport preview (0-indexed)
  const [selectedClassStudentIndex, setSelectedClassStudentIndex] = useState<number>(0);

  // Range for batch printing
  const [rangeStart, setRangeStart] = useState<number>(1);
  const [rangeEnd, setRangeEnd] = useState<number>(15);

  // Modals state
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<CalculatedStudent | null>(null);
  const [isBatchPrintOpen, setIsBatchPrintOpen] = useState(false);
  const [designConfig, setDesignConfig] = useState<ReportDesignConfig>(() => getSavedDesignConfig());
  const [isEditingMode, setIsEditingMode] = useState<boolean>(false);
  const [selectedCol, setSelectedCol] = useState<SelectedColumnKey>('no');

  const handleSelectSchoolType = (type: SchoolType) => {
    setSchoolType(type);
    try {
      localStorage.setItem('kasyfud_darajat_active_school_type', type);
    } catch {}

    const matchingClasses = classSelection.scopedClasses.filter((c) =>
      type === 'fullday' ? c.schoolType === 'fullday' : c.schoolType !== 'fullday'
    );
    if (matchingClasses.length > 0) {
      setSelectedClassId(matchingClasses[0].id);
      setSelectedClassStudentIndex(0);
    }
  };

  // Excel Cell Selection & Formula Bar Sync
  const [activeCellLabel, setActiveCellLabel] = useState<string>('A1');
  const [activeCellValue, setActiveCellValue] = useState<string>('');
  const [activeCellCoord, setActiveCellCoord] = useState<{ row: number; col: number } | null>(null);

  // Custom Subject Overrides (Arabic name, Latin name, Custom Terbilang)
  const [customSubjectOverrides, setCustomSubjectOverrides] = useState<
    Record<string, { nameAr?: string; nameId?: string; customTerbilang?: string }>
  >(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_OVERRIDES);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_OVERRIDES, JSON.stringify(customSubjectOverrides));
    } catch {
      // ignore
    }
  }, [customSubjectOverrides]);

  // Custom Class Subjects (Dynamic add/delete rows per class)
  const [customClassSubjects, setCustomClassSubjects] = useState<Record<string, Subject[]>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CLASS_SUBJECTS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CLASS_SUBJECTS, JSON.stringify(customClassSubjects));
    } catch {
      // ignore
    }
  }, [customClassSubjects]);

  const handleUpdateSubjectName = (
    subjectId: string,
    overrides: { nameAr?: string; nameId?: string; customTerbilang?: string }
  ) => {
    setCustomSubjectOverrides((prev) => ({
      ...prev,
      [subjectId]: {
        ...prev[subjectId],
        ...overrides,
      },
    }));
  };

  const handleActiveCellChange = (
    label: string,
    value: string,
    coord?: { row: number; col: number }
  ) => {
    setActiveCellLabel(label);
    setActiveCellValue(value);
    if (coord) {
      setActiveCellCoord(coord);
    }
  };

  const handleSaveDesignConfig = (newConfig: ReportDesignConfig) => {
    setDesignConfig(newConfig);
    saveDesignConfig(newConfig);
  };

  // Auto-sync config header class information when selectedClassId changes
  useEffect(() => {
    const cls = classes.find((c) => c.id === selectedClassId) || INITIAL_CLASSES.find((c) => c.id === selectedClassId);
    if (cls) {
      const isFullDay = cls.schoolType === 'fullday';
      const officialWali = cls.waliKelasName || getWaliKelasForClass(cls.id, classes) || getWaliKelasForClass(cls.nameLatin, classes);
      setConfig((prev) => ({
        ...prev,
        classLatin: cls.nameLatin,
        classAr: cls.nameAr,
        waliKelasName: officialWali || prev.waliKelasName,
        schoolType: isFullDay ? 'fullday' : 'mukim',
        subTitleId: isFullDay ? 'ASESMEN TENGAH SEMESTER GANJIL' : prev.subTitleId,
        schoolName: isFullDay
          ? (cls.nameLatin.toLowerCase().includes('smp') || cls.id.startsWith('vii') || cls.id.startsWith('viii') || cls.id.startsWith('ix') ? 'SMP ISLAM AL-GHOZALI' : 'SMA ISLAM AL GHOZALI')
          : (prev.schoolType === 'fullday' ? 'KMI PONDOK MODERN AL-GHOZALI' : prev.schoolName),
        programStudi: cls.jurusan || prev.programStudi || (isFullDay ? 'UMUM' : undefined),
        kepalaSekolahName: isFullDay
          ? (cls.nameLatin.toLowerCase().includes('smp') || cls.id.startsWith('vii') || cls.id.startsWith('viii') || cls.id.startsWith('ix') ? 'ISWAHYUDIN, SE' : 'Antoni Firdaus, M.Pd.')
          : prev.kepalaSekolahName,
        kepalaSekolahSmpName: 'ISWAHYUDIN, SE',
      }));
    }
  }, [selectedClassId, classes]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CLASSES, JSON.stringify(classes));
    } catch {
      // ignore
    }
  }, [classes]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
    } catch {
      // ignore
    }
  }, [config]);

  // Save config and update per-class settings in classes state so wali kelas is not permanent
  const handleSaveConfig = (newConf: SchoolConfig) => {
    setConfig(newConf);
    if (newConf.waliKelasName) {
      setClasses((prevClasses) =>
        prevClasses.map((c) => {
          if (c.id === selectedClassId || c.nameLatin === newConf.classLatin) {
            return {
              ...c,
              waliKelasName: newConf.waliKelasName,
              nameLatin: newConf.classLatin || c.nameLatin,
              nameAr: newConf.classAr || c.nameAr,
            };
          }
          return c;
        })
      );
    }
  };

  // Dynamically compute totals, averages, and ranks for ALL students grouped by class
  const calculatedStudents: CalculatedStudent[] = useMemo(() => {
    // 1. Calculate raw total and average for each student based on their class-specific curriculum
    const withTotals = students.map((std) => {
      const classId = std.classId || '1a';
      const classSubjects = customClassSubjects[classId] || getSubjectsForClass(classId);
      const studentScores = ensureStudentScoresForClass(std.scores, classId, std.nisn || std.id);
      const total = classSubjects.reduce((sum, sub) => {
        const val = studentScores[sub.id];
        return sum + (typeof val === 'number' && !isNaN(val) ? val : 0);
      }, 0);
      const avg = classSubjects.length > 0 ? Math.round(total / classSubjects.length) : 0;
      return {
        ...std,
        scores: studentScores,
        totalScore: total,
        averageScore: avg,
        rank: 1, // placeholder
      };
    });

    // 2. Rank students descending by totalScore WITHIN EACH CLASS
    const rankMap = new Map<string, number>();
    const byClass: Record<string, typeof withTotals> = {};

    withTotals.forEach((s) => {
      const cId = s.classId || '1a';
      if (!byClass[cId]) byClass[cId] = [];
      byClass[cId].push(s);
    });

    Object.values(byClass).forEach((classGroup) => {
      const sorted = [...classGroup].sort((a, b) => b.totalScore - a.totalScore);
      let currentRank = 1;
      sorted.forEach((item, idx) => {
        if (idx > 0 && item.totalScore < sorted[idx - 1].totalScore) {
          currentRank = idx + 1;
        }
        rankMap.set(item.id, currentRank);
      });
    });

    // 3. Return students with assigned ranks
    return withTotals.map((s) => ({
      ...s,
      rank: rankMap.get(s.id) || 1,
    }));
  }, [students, customClassSubjects]);

  // Current subjects for the currently selected class
  const currentClassSubjects = useMemo(() => {
    return customClassSubjects[selectedClassId] || getSubjectsForClass(selectedClassId);
  }, [customClassSubjects, selectedClassId]);

  // Ensure active subject ID matches available subjects in selected class
  useEffect(() => {
    if (
      currentClassSubjects.length > 0 &&
      !currentClassSubjects.some((s) => s.id === selectedSubjectId)
    ) {
      setSelectedSubjectId(currentClassSubjects[0].id);
    }
  }, [currentClassSubjects, selectedSubjectId]);

  // Students in currently selected class
  const studentsInCurrentClass = useMemo(() => {
    return calculatedStudents.filter(
      (s) => (s.classId || '1a') === selectedClassId
    );
  }, [calculatedStudents, selectedClassId]);

  // Safe active student for Raport view
  const safeIndex = Math.max(
    0,
    Math.min(selectedClassStudentIndex, studentsInCurrentClass.length - 1)
  );
  const activeStudent = studentsInCurrentClass[safeIndex] || studentsInCurrentClass[0];

  // Update batch print range when class changes
  useEffect(() => {
    setRangeStart(1);
    setRangeEnd(Math.max(1, studentsInCurrentClass.length));
  }, [selectedClassId, studentsInCurrentClass.length]);

  // Handlers
  const handleUpdateStudentName = (studentId: string, newName: string) => {
    queueChange({ kind: 'identity', id: studentId, name: newName });
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? { ...s, name: newName } : s))
    );
  };

  const handleUpdateSikap = (studentId: string, value: string) => {
    const student = students.find(item => item.id === studentId);
    if (!student || !canManageClass(currentUser, student.classId)) return;
    queueChange({ kind: 'attitude', id: studentId, value });
    setStudents((prev) =>
      prev.map((student) => (student.id === studentId ? { ...student, sikap: value } : student))
    );
  };

  const handleUpdateStudentNisn = (studentId: string, newNisn: string) => {
    queueChange({ kind: 'identity', id: studentId, nisn: newNisn });
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? { ...s, nisn: newNisn } : s))
    );
  };

  const handleAddSubject = () => {
    const existingSubjects = currentClassSubjects;
    const nextNumber = existingSubjects.length + 1;
    const newSubjectId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newSubject: Subject = {
      id: newSubjectId,
      order: nextNumber,
      nameAr: `مادة جديدة ${nextNumber}`,
      nameId: `Mata Pelajaran ${nextNumber}`,
      category: 'umum',
    };
    const updated = [...existingSubjects, newSubject];

    setCustomClassSubjects((prev) => ({
      ...prev,
      [selectedClassId]: updated,
    }));

    // Initialize score (80) for this subject on all students in current class
    setStudents((prev) =>
      prev.map((s) => {
        if ((s.classId || '1a') !== selectedClassId) return s;
        return {
          ...s,
          scores: {
            ...s.scores,
            [newSubjectId]: s.scores[newSubjectId] ?? (undefined as unknown as number),
          },
        };
      })
    );
  };

  const handleDeleteSubject = (subjectId: string) => {
    const existingSubjects = currentClassSubjects;
    const updated = existingSubjects
      .filter((s) => s.id !== subjectId)
      .map((s, idx) => ({
        ...s,
        order: idx + 1, // renumber sequentially
      }));

    setCustomClassSubjects((prev) => ({
      ...prev,
      [selectedClassId]: updated,
    }));

    // Clean up score key from students in this class
    setStudents((prev) =>
      prev.map((s) => {
        if ((s.classId || '1a') !== selectedClassId) return s;
        const newScores = { ...s.scores };
        delete newScores[subjectId];
        return {
          ...s,
          scores: newScores,
        };
      })
    );
  };

  const handleDeleteActiveRow = () => {
    if (!activeCellCoord) return;
    const subject = currentClassSubjects[activeCellCoord.row];
    if (subject) {
      handleDeleteSubject(subject.id);
    }
  };
  const handleUpdateScore = (studentId: string, subjectId: string, value: number) => {
    const student = students.find(item => item.id === studentId);
    if (!student || !canUserEditSubject(currentUser, subjectId, student.classId)) return;
    // 1. Update UI lokal seketika (0 ms latency, layar tidak freeze!)
    queueChange({ kind: 'score', id: studentId, subjectId, value });
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id !== studentId) return s;
        return {
          ...s,
          scores: {
            ...s.scores,
            [subjectId]: value,
          },
        };
      })
    );


  };

  const handleChangeCellValue = (newVal: string) => {
    setActiveCellValue(newVal);
    if (!activeCellCoord || !activeStudent) return;
    const { row, col } = activeCellCoord;
    const subject = currentClassSubjects[row];
    if (!subject) return;

    if (col === 3) {
      // Nilai
      const numVal = Math.max(0, Math.min(100, Number(newVal) || 0));
      handleUpdateScore(activeStudent.id, subject.id, numVal);
    } else if (col === 1) {
      handleUpdateSubjectName(subject.id, { nameAr: newVal });
    } else if (col === 2) {
      handleUpdateSubjectName(subject.id, { nameId: newVal });
    } else if (col === 4) {
      handleUpdateSubjectName(subject.id, { customTerbilang: newVal });
    }
  };

  const handleSaveStudent = (data: {
    id?: string;
    classId: string;
    name: string;
    nisn: string;
    scores: Record<string, number>;
    keterangan?: string;
  }) => {
    if (data.id) {
      queueChange({ kind: 'upsert', student: { ...data, id: data.id } });
      // Edit existing
      setStudents((prev) =>
        prev.map((s) =>
          s.id === data.id
            ? {
                ...s,
                classId: data.classId,
                name: data.name,
                nisn: data.nisn,
                scores: data.scores,
                keterangan: data.keterangan,
              }
            : s
        )
      );
    } else {
      // Add new
      const newStudent: StudentRecord = {
        id: crypto.randomUUID(),
        no: students.length + 1,
        classId: data.classId,
        name: data.name,
        nisn: data.nisn,
        scores: data.scores,
        keterangan: data.keterangan || 'Tuntas',
      };
      queueChange({ kind: 'upsert', student: newStudent });
      setStudents((prev) => [...prev, newStudent]);
      setSelectedClassId(data.classId);
    }
  };

  const handleDeleteStudent = (studentId: string) => {
    if (students.length <= 1) {
      return;
    }
    queueChange({ kind: 'delete', id: studentId });
    setStudents((prev) => prev.filter((s) => s.id !== studentId));
    if (selectedClassStudentIndex >= studentsInCurrentClass.length - 1) {
      setSelectedClassStudentIndex(Math.max(0, studentsInCurrentClass.length - 2));
    }
  };

  const handleReloadStudents = () => {
    void flushChanges().then(getStudents).then((records) => {
      setStudents(records);
      setAccessMessage('');
    }).catch((error: Error) => setAccessMessage(error.message));
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handlePrintSingle = () => {
    window.print();
  };

  /**
   * Menggunakan exportRaportToPdf untuk mengekspor
   * tampilan aktif ReportCertificate ke dalam file PDF resmi (F4).
   */
  const handleDownloadActiveRaportPdf = async () => {
    if (!activeStudent) return;
    const certificateEl = document.getElementById('raport-certificate-container');
    if (!certificateEl) {
      alert('Elemen raport santri tidak ditemukan.');
      return;
    }

    setIsExportingPdf(true);
    try {
      const safeStudentName = activeStudent.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeClassName = (config.classLatin || selectedClassId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `Raport_${safeStudentName}_${safeClassName}.pdf`;

      const success = await exportRaportToPdf(certificateEl, fileName);
      if (!success) {
        alert('Gagal mengekspor PDF. Anda dapat menggunakan tombol Cetak browser sebagai alternatif.');
      }
    } catch (error) {
      console.error('Gagal mencetak raport ke PDF:', error);
      alert('Gagal mengekspor PDF. Anda dapat menggunakan tombol Cetak browser sebagai alternatif.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleOpenBatchPrint = () => {
    setIsBatchPrintOpen(true);
  };

  const handleOpenRaportForStudent = (studentId: string) => {
    const student = calculatedStudents.find((s) => s.id === studentId);
    if (student && canManageClass(currentUser, student.classId)) {
      const targetClass = student.classId || '1a';
      setSelectedClassId(targetClass);
      const classStudents = calculatedStudents.filter((s) => (s.classId || '1a') === targetClass);
      const idxInClass = classStudents.findIndex((s) => s.id === studentId);
      if (idxInClass !== -1) {
        setSelectedClassStudentIndex(idxInClass);
      }
      setActiveTab('raport');
    }
  };

  const handleNavigateToGrading = (classId: string) => {
    setSelectedClassId(classId);
    setActiveTab('guru');
  };

  const handleSelectJenjang = (unit: JenjangUnit) => {
    setActiveJenjang(unit);
    const classesForUnit = classSelection.scopedClasses.filter(item =>
      (item.schoolType ?? 'mukim') === schoolType && (unit === 'TMMIA' || getJenjangForClass(item) === unit));
    if (classesForUnit.length > 0) {
      setSelectedClassId(classesForUnit[0].id);
      setSelectedClassStudentIndex(0);
    }
  };

  const handleSelectClassWithJenjangSync = (classId: string) => {
    if (classId === 'all') {
      setSelectedClassId('all');
      return;
    }
    const targetClass = classSelection.scopedClasses.find((c) => c.id === classId);
    if (!targetClass) return;
    if (targetClass) {
      const targetJenjang = getJenjangForClass(targetClass);
      if (targetJenjang && targetJenjang !== activeJenjang) {
        setActiveJenjang(targetJenjang);
      }
    }
    setSelectedClassId(classId);
    setSelectedClassStudentIndex(0);
  };

  const handleLoginSuccess = (user: AuthUser, preferredUnit?: JenjangUnit) => {
    setLoginNotice('');
    setAccessMessage('');
    setAccountMismatch(false);
    setCurrentUser(user);

    const userSchoolType = user.schoolType;
    const targetSchoolType = userSchoolType || schoolType;
    if (userSchoolType) {
      setSchoolType(userSchoolType);
      try {
        localStorage.setItem('kasyfud_darajat_active_school_type', userSchoolType);
      } catch {}
    }

    const initialUnit: JenjangUnit = preferredUnit && user.availableUnits?.includes(preferredUnit) ? preferredUnit : user.unit || user.availableUnits?.[0] || 'SMP';
    setActiveJenjang(initialUnit);

    const initialView = user.role === 'guru' ? 'guru' : user.role === 'wali_kelas' ? 'raport' : 'master';
    const initialSelection = selectWorkspaceClasses(user, initialView, classes, {
      schoolType: targetSchoolType, jenjang: initialUnit, classId: user.homeroomClassId || '',
    });
    setSchoolType(initialSelection.schoolType);
    setActiveJenjang(initialSelection.activeJenjang);
    const initialClasses = initialSelection.filteredClasses;

    if (user.role === 'guru') {
      setActiveTab('guru');
      if (initialClasses.length > 0) {
        setSelectedClassId(initialClasses[0].id);
      }
    } else if (user.role === 'wali_kelas') {
      if (user.homeroomClassId) {
        setSelectedClassId(user.homeroomClassId);
      } else if (initialClasses.length > 0) {
        setSelectedClassId(initialClasses[0].id);
      }
      setActiveTab('raport');
    } else {
      setActiveTab('master');
      if (initialClasses.length > 0) {
        setSelectedClassId(initialClasses[0].id);
      }
    }
  };

  useEffect(() => {
    const onHashChange = () => {
      setLinkToken(readLoginLinkToken(window.location.hash));
      setPinSlug(readPinLinkSlug(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSession(true);
    setCurrentUser(null);
    setStudents([]);
    setPersonalLink(null);
    setAccessMessage('');
    setAccountMismatch(false);
    setInactiveLink(false);
    const resolveSession = async () => {
      if (pinSlug) {
        const preview = await previewPinLink(pinSlug);
        if (!cancelled) setPersonalLink(preview);
        return getPinLinkedSession(pinSlug);
      }
      if (!linkToken) return getSession();
      const preview = await previewLoginLink(linkToken);
      if (!cancelled) setPersonalLink(preview);
      return getLinkedSession(linkToken);
    };
    resolveSession().then((user) => {
      if (!cancelled && user) handleLoginSuccess(user);
    }).catch((error: Error) => {
      if (!cancelled) {
        setAccountMismatch(Boolean((linkToken || pinSlug) && error instanceof RaportApiError && error.status === 403));
        setInactiveLink(Boolean((linkToken || pinSlug) && error instanceof RaportApiError && error.status === 404));
        if (!(error instanceof RaportApiError && error.status === 401)) setAccessMessage(error.message);
      }
    }).finally(() => {
      if (!cancelled) setIsLoadingSession(false);
    });
    return () => { cancelled = true; };
  }, [linkToken, pinSlug]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    getStudents().then((records) => {
      if (!cancelled) setStudents(records);
    }).catch((error: Error) => {
      if (!cancelled) setAccessMessage(error.message);
    });
    return () => { cancelled = true; };
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      await flushChanges();
      await logout(currentUser?.loginMethod);
      setStudents([]);
      setAccessMessage('');
      setCurrentUser(null);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'Gagal keluar.');
    }
  };

  if (isLoadingSession) return <p className="p-6 text-center">Memeriksa sesi…</p>;
  if (!currentUser) {
    return <LoginView onLoginSuccess={handleLoginSuccess} personalLink={personalLink} linkToken={linkToken} pinSlug={pinSlug} accountMismatch={accountMismatch} inactiveLink={inactiveLink} errorMessage={accessMessage} noticeMessage={loginNotice} />;
  }

  const isAdmin = currentUser.role === 'admin';
  const isWaliKelas = currentUser.role === 'wali_kelas';
  const isGuru = currentUser.role === 'guru';

  return (
    <>
      <AppShell user={currentUser} activeView={activeTab} onSelectView={setActiveTab}
        schoolType={schoolType} onSelectSchoolType={handleSelectSchoolType}
        activeJenjang={activeJenjang} onSelectJenjang={handleSelectJenjang}
        availableSchoolTypes={classSelection.availableSchoolTypes} availableUnits={classSelection.availableUnits}
        academicYear={config.academicYearLatin} studentCount={students.length} isSaving={isSaving}
        onReload={handleReloadStudents} onLogout={handleLogout} hideWhenPrinting={isBatchPrintOpen}>
        {activeTab==='pin'&&currentUser.loginMethod==='pin'? (
          <ChangePinView name={currentUser.name} beforeChange={flushChanges} onChanged={()=>{setStudents([]);setAccessMessage('');setPersonalLink({name:currentUser.name,role:currentUser.role});setLoginNotice('PIN berhasil diubah. Silakan masuk kembali dengan PIN baru.');setCurrentUser(null);}}/>
        ) : !isAdmin && filteredClassesForUser.length === 0 ? (
          <div role="status" className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-600">Belum ada kelas yang ditugaskan untuk fitur ini. Hubungi administrator sekolah untuk memeriksa penugasan Anda.</div>
        ) : activeTab === 'settings' && isAdmin ? (
          <SettingsModal embedded isOpen onClose={() => setActiveTab('raport')} config={config} onSave={handleSaveConfig} />
        ) : activeTab === 'design' && isAdmin ? (
          <ReportDesignModal embedded isOpen onClose={() => setActiveTab('raport')} currentConfig={designConfig} onSaveConfig={handleSaveDesignConfig} />
        ) : activeTab === 'accounts' && isAdmin ? (
          <AccountAccessModal embedded onClose={() => setActiveTab('raport')} />
        ) : activeTab === 'master' ? (
          /* View 0: Data Master Siswa */
          <DataMasterView
            students={calculatedStudents.filter((s) => {
              if (schoolType === 'fullday') {
                return s.schoolType === 'fullday' || classes.some((c) => c.id === s.classId && c.schoolType === 'fullday');
              }
              return s.schoolType !== 'fullday' && !classes.some((c) => c.id === s.classId && c.schoolType === 'fullday');
            })}
            classes={filteredClassesForUser}
            selectedClassId={selectedClassId}
            onSelectClassId={setSelectedClassId}
            onImportZip={isAdmin ? async (file) => {
              await flushChanges();
              const result = await importLegacyZip(file);
              await getStudents().then(setStudents).catch((error: Error) => setAccessMessage(error.message));
              return result;
            } : undefined}
            onAddStudent={() => {
              setEditingStudent(null);
              setIsStudentModalOpen(true);
            }}
            onEditStudent={(std) => {
              setEditingStudent(std);
              setIsStudentModalOpen(true);
            }}
            onDeleteStudent={handleDeleteStudent}
            onNavigateToGrading={handleNavigateToGrading}
            onNavigateToRaport={handleOpenRaportForStudent}
            schoolType={schoolType}
          />
        ) : activeTab === 'sikap' ? (
          <SikapView
            studentsInClass={studentsInCurrentClass}
            selectedClassId={selectedClassId}
            classes={filteredClassesForUser}
            onSelectClassId={setSelectedClassId}
            onUpdateSikap={handleUpdateSikap}
            currentUser={currentUser}
          />
        ) : activeTab === 'muatan' ? (
          /* View: Muatan Mata Pelajaran (Matriks Lengkap 13 Kolom Sesuai Dokumen Kurikulum) */
          <MuatanMataPelajaranView
            onNavigateToGrading={(cId) => {
              setSelectedClassId(cId);
              setActiveTab('guru');
            }}
          />
        ) : activeTab === 'databaseGuru' ? (
          /* View: Database Guru Mata Pelajaran (63 Mapel SMA, SMP, TMMIA) */
          <TeacherDatabaseView
            onNavigateToGrading={(cId) => {
              if (cId) setSelectedClassId(cId);
              setActiveTab('guru');
            }}
          />
        ) : activeTab === 'guru' ? (
          /* View 1: Guru Pilih Kelas -> Tampil Siswa -> Pilih Mapel Yang Diajar */
          <TeacherGradingView
            classes={filteredClassesForUser}
            selectedClassId={selectedClassId}
            onSelectClassId={setSelectedClassId}
            subjects={currentClassSubjects}
            selectedSubjectId={selectedSubjectId}
            onSelectSubjectId={setSelectedSubjectId}
            studentsInClass={studentsInCurrentClass}
            allStudents={calculatedStudents.filter(student => classSelection.scopedClasses.some(item => item.id === student.classId))}
            onUpdateScore={handleUpdateScore}
            onOpenRaportForStudent={handleOpenRaportForStudent}
            availableJenjang={classSelection.availableUnits}
            currentUser={currentUser}
            activeJenjang={activeJenjang}
            onSelectJenjang={handleSelectJenjang}
          />
        ) : activeTab === 'raport' ? (
          <div className="min-w-0 space-y-5 print:space-y-0">
            <SidebarControls
              students={studentsInCurrentClass} classes={filteredClassesForUser}
              selectedClassId={selectedClassId} onSelectClassId={setSelectedClassId}
              selectedIndex={safeIndex} onSelectIndex={setSelectedClassStudentIndex}
              rangeStart={rangeStart} rangeEnd={rangeEnd}
              onChangeRangeStart={setRangeStart} onChangeRangeEnd={setRangeEnd}
              onPrintSingle={handlePrintSingle} onPrintBatch={handleOpenBatchPrint}
              onDownloadPdf={handleDownloadActiveRaportPdf} isExportingPdf={isExportingPdf}
              onOpenRekap={() => setActiveTab('rekap')}
              onOpenSettings={() => setActiveTab('settings')}
              onOpenDesignModal={() => setActiveTab('design')}
              onEditStudent={(student) => {setEditingStudent(student);setIsStudentModalOpen(true);}}
              config={config} currentUser={currentUser} activeJenjang={activeJenjang}
              onSelectJenjang={handleSelectJenjang} isEditingMode={isEditingMode}
              onToggleEditingMode={() => setIsEditingMode(value => !value)}
            />
            {activeStudent ? <>
              {isAdmin && isEditingMode && <div className="no-print"><ExcelTableToolbar
                designConfig={designConfig || DEFAULT_DESIGN_CONFIG}
                onUpdateDesignConfig={handleSaveDesignConfig} selectedCol={selectedCol}
                onSelectCol={setSelectedCol} onClose={() => setIsEditingMode(false)}
                activeCellLabel={activeCellLabel} activeCellValue={activeCellValue}
                onChangeCellValue={handleChangeCellValue} onAddRow={handleAddSubject} onDeleteRow={handleDeleteActiveRow}
              /></div>}
              <div className="w-full min-w-0 overflow-x-auto pb-6 print:overflow-visible print:p-0">
                <div className="mx-auto w-fit print:m-0 print:w-full"><ReportCertificate
                  student={activeStudent} subjects={currentClassSubjects} config={config} classes={classes}
                  designConfig={designConfig} onUpdateDesignConfig={handleSaveDesignConfig}
                  onUpdateScore={handleUpdateScore} customSubjectOverrides={customSubjectOverrides}
                  onUpdateSubjectName={handleUpdateSubjectName} isEditingMode={isEditingMode}
                  selectedCol={selectedCol} onSelectCol={setSelectedCol} onActiveCellChange={handleActiveCellChange}
                  onOpenDateSettings={() => setActiveTab('settings')}
                  onUpdateStudentName={handleUpdateStudentName} onUpdateNisn={handleUpdateStudentNisn}
                  onAddSubject={handleAddSubject} onDeleteSubject={handleDeleteSubject}
                /></div>
              </div>
            </> : <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-base text-stone-600">Belum ada santri di kelas {config.classLatin}.</div>}
          </div>
        ) : (
          /* View 3: Rekapitulasi Nilai Asesmen Sumatif (Image 2 layout) */
          <div className="w-full">
            <RekapitulasiTable
              students={calculatedStudents.filter(student => workspaceStudents.some(item => item.id === student.id))}
              subjects={currentClassSubjects}
              config={config}
              classes={filteredClassesForUser}
              allClasses={classSelection.scopedClasses}
              activeJenjang={activeJenjang}
              onSelectJenjang={handleSelectJenjang}
              selectedClassId={selectedClassId}
              onSelectClassId={handleSelectClassWithJenjangSync}
              onUpdateScore={handleUpdateScore}
              onAddStudent={() => {
                setEditingStudent(null);
                setIsStudentModalOpen(true);
              }}
              onDeleteStudent={handleDeleteStudent}
              onSelectStudentForRaport={(idx) => {
                setSelectedClassStudentIndex(idx);
                setActiveTab('raport');
              }}
              onOpenBatchPrint={handleOpenBatchPrint}
              onReloadData={handleReloadStudents}
              currentUser={currentUser}
              schoolType={schoolType}
            />
          </div>
        )}
      </AppShell>
      {/* Modals */}
      <StudentModal
        isOpen={isStudentModalOpen}
        onClose={() => setIsStudentModalOpen(false)}
        student={editingStudent}
        subjects={subjects}
        classes={classes}
        defaultClassId={selectedClassId}
        onSave={handleSaveStudent}
      />


      <BatchPrintView
        isOpen={isBatchPrintOpen}
        onClose={() => setIsBatchPrintOpen(false)}
        students={studentsInCurrentClass}
        subjects={currentClassSubjects}
        config={config}
        classes={classes}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onChangeRangeStart={setRangeStart}
        onChangeRangeEnd={setRangeEnd}
        designConfig={designConfig}
        customSubjectOverrides={customSubjectOverrides}
      />

      {accessMessage && (
        <div role="alert" className="no-print fixed bottom-4 left-4 z-50 max-w-lg rounded-lg bg-red-800 p-3 text-white">
          <span>{accessMessage}</span>
          <button type="button" className="ml-2 font-bold underline" onClick={handleReloadStudents}>Muat ulang</button>
        </div>
      )}


    </>
  );
}
