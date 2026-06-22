import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Table, Button, Input, Space, Tag, Card, Typography,
  message, Popconfirm, Divider, AutoComplete, InputNumber, Select, Tooltip, Modal,
} from 'antd';
import {
  FilePdfOutlined, EyeOutlined, LockOutlined, DownloadOutlined,
  ArrowLeftOutlined, FileExcelOutlined, BookOutlined, InfoCircleOutlined,
  PlusOutlined, DeleteOutlined, HistoryOutlined, FileWordOutlined
} from '@ant-design/icons';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { Document, Packer, Paragraph, Table as DocxTable, TableRow, TableCell, WidthType, AlignmentType, TextRun, BorderStyle, TabStopType, TabStopPosition } from 'docx';
import { saveAs } from 'file-saver';

(pdfMake as any).addVirtualFileSystem(pdfFonts);
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { StudentTranscript, TranscriptGradeEntry, TranscriptCourseSearchResult, University } from '../types';
import {
  getTranscript, saveTranscriptGrades,
  searchTranscriptCourses, previewConversion, submitTranscriptForReview,
  deleteTranscriptGradeEntry, getGradingSchemes, getEctsIkuConversion, getStudentApplication,
  updateTranscriptGradeEntry, getUniversities, getUniversityCourses,
  getSchemeVersion, getSchemeVersions,
} from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { TRANSCRIPT_STATUS_CONFIG } from '../constants/status';

const { Title, Text } = Typography;

interface GradeRow {
  key: string;
  partner_course_id: number | null;
  partner_course_name: string;
  partner_course_code: string | null;
  partner_ects: number | null;
  local_grade: string;
  ects_grade?: string;
  iku_grade?: string;
  conversion_mode: 'auto_local' | 'auto_ects';
  conversion_method?: string;
  grading_scheme_name?: string;
  grading_scheme_version_number?: number | null;
  grading_scheme_version_id?: number | null;
  grading_scheme_id?: number | null;
  ects_iku_version_number?: number | null;
  ects_iku_version_id?: number | null;
  is_db_course: boolean;
  existing_id?: number;
  searchResults: TranscriptCourseSearchResult[];
  mapped_home_course_ids?: number[];
}

export default function StudentTranscriptDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeDepartment } = useAuth();

  const searchTimeout = useRef<any>(null);

  const [gradeRows, setGradeRows] = useState<GradeRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [overviewVisible, setOverviewVisible] = useState(false);
  const [schemeModalVisible, setSchemeModalVisible] = useState(false);
  const [versionDetailData, setVersionDetailData] = useState<any>(null);
  const [schemeVersionId, setSchemeVersionId] = useState<number | null>(null);
  const [ectsIkuVersionId, setEctsIkuVersionId] = useState<number | null>(null);
  const [schemeVersionLoading, setSchemeVersionLoading] = useState(false);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const laPrefilled = useRef(false);

  useEffect(() => {
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, []);

  const { data: universities = [] } = useQuery({
    queryKey: ['universities', activeDepartment],
    queryFn: () => getUniversities(activeDepartment),
  });

  const { data: transcript, isLoading: detailLoading } = useQuery({
    queryKey: ['transcript', id],
    queryFn: () => getTranscript(Number(id!)),
    enabled: !!id,
  });

  const { data: schemes = [] } = useQuery({
    queryKey: ['grading-schemes-transcripts', activeDepartment],
    queryFn: () => getGradingSchemes({ department_code: activeDepartment }),
  });

  const { data: ectsIkuMap = [] } = useQuery({
    queryKey: ['ects-iku-map'],
    queryFn: getEctsIkuConversion,
  });

  const { data: linkedApplication } = useQuery({
    queryKey: ['transcript-application', transcript?.application_id],
    queryFn: () => transcript?.application_id ? getStudentApplication(transcript.application_id) : Promise.resolve(null),
    enabled: !!transcript?.application_id,
  });

  const homeUniversity = universities.find((u: University) => u.is_home);

  const { data: homeCoursesRes } = useQuery({
    queryKey: ['home-courses', homeUniversity?.id],
    queryFn: () => homeUniversity?.id
      ? getUniversityCourses(homeUniversity.id, { limit: 1000 })
      : Promise.resolve({ courses: [], total: 0, skip: 0, limit: 1000 } as any),
    enabled: !!homeUniversity && !!transcript,
  });

  const homeCourseOptions = (homeCoursesRes as any)?.courses?.map((c: any) => ({
    value: c.id,
    label: `${c.course_code || ''} ${c.course_name} (${c.ects} ${t('courseTable.columns.ects')})`,
  })) || [];

  const initGradeRows = useCallback((entries: TranscriptGradeEntry[]) => {
    setGradeRows(entries.map(e => {
      const matchingSelection = linkedApplication?.selections?.find((s: any) =>
        s.partner_course_id === e.partner_course_id ||
        (e.partner_course_code && s.partner_course?.course_code === e.partner_course_code) ||
        (s.partner_course?.course_name?.toLowerCase().trim() === e.partner_course_name?.toLowerCase().trim())
      );

      const laOverrideIds = matchingSelection?.coordinator_override_courses?.map((c: any) => c.id) || [];
      const laSelectedIds = matchingSelection?.selected_home_course_ids || [];

      let finalMappedIds: number[] = e.mapped_home_course_ids || [];
      if (laOverrideIds.length > 0) {
        finalMappedIds = laOverrideIds;
      } else if (finalMappedIds.length === 0 && laSelectedIds.length > 0) {
        finalMappedIds = laSelectedIds;
      }

      return {
        key: `existing-${e.id}`,
        partner_course_id: e.partner_course_id,
        partner_course_name: e.partner_course_name,
        partner_course_code: e.partner_course_code,
        partner_ects: e.partner_ects,
        local_grade: e.local_grade || '',
        ects_grade: e.ects_grade || undefined,
        iku_grade: e.iku_grade || undefined,
        conversion_mode: e.conversion_method === 'auto_ects' ? 'auto_ects' : 'auto_local',
        conversion_method: e.conversion_method || undefined,
        grading_scheme_name: e.grading_scheme_name || undefined,
        grading_scheme_version_number: e.grading_scheme_version_number ?? undefined,
        grading_scheme_version_id: e.grading_scheme_version_id ?? undefined,
        grading_scheme_id: e.grading_scheme_id ?? undefined,
        ects_iku_version_number: e.ects_iku_version_number ?? undefined,
        ects_iku_version_id: e.ects_iku_version_id ?? undefined,
        is_db_course: e.is_db_course,
        mapped_home_course_ids: finalMappedIds,
        existing_id: e.id,
        searchResults: [],
      };
    }));
  }, [linkedApplication]);

  useEffect(() => {
    setGradeRows([]);
    setSelectedRowKey(null);
    setPdfPreviewUrl(null);
    laPrefilled.current = false;
  }, [id]);

  useEffect(() => {
    if (transcript?.file_path) {
      setPdfPreviewUrl(transcript.file_path);
    }
  }, [transcript?.file_path]);

  useEffect(() => {
    if (transcript && transcript.grade_entries && transcript.grade_entries.length > 0) {
      const needsInit = gradeRows.length === 0;
      const needsLAUpdate = linkedApplication && !laPrefilled.current;
      if (needsInit || needsLAUpdate) {
        initGradeRows(transcript.grade_entries);
        if (linkedApplication) laPrefilled.current = true;
      }
    }
  }, [transcript, linkedApplication, gradeRows.length, initGradeRows]);

  useEffect(() => {
    if (!laPrefilled.current && transcript && gradeRows.length === 0 && (!transcript.grade_entries || transcript.grade_entries.length === 0) && linkedApplication?.selections?.length) {
      const laRows: GradeRow[] = linkedApplication.selections
        .filter((s: any) => s.partner_course && s.status !== 'not_selected' && s.status !== 'rejected')
        .map((s: any) => ({
          key: `la-${s.id}`,
          partner_course_id: s.partner_course_id,
          partner_course_name: s.partner_course?.course_name || '',
          partner_course_code: s.partner_course?.course_code || null,
          partner_ects: s.partner_course?.ects || null,
          local_grade: '',
          conversion_mode: 'auto_local' as const,
          is_db_course: true,
          mapped_home_course_ids: (s.coordinator_override_courses?.length || 0) > 0
            ? s.coordinator_override_courses!.map((c: any) => c.id)
            : (s.selected_home_course_ids || []),
          searchResults: [],
        }));
      if (laRows.length > 0) {
        laPrefilled.current = true;
        setGradeRows(laRows);
      }
    }
  }, [transcript, linkedApplication, gradeRows.length]);

  const addEmptyRow = () => {
    const newKey = `new-${Date.now()}`;
    setGradeRows(prev => [...prev, {
      key: newKey,
      partner_course_id: null,
      partner_course_name: '',
      partner_course_code: null,
      partner_ects: null,
      local_grade: '',
      conversion_mode: 'auto_local',
      is_db_course: false,
      mapped_home_course_ids: [],
      searchResults: [],
    }]);
    setSelectedRowKey(newKey);
  };

  const updateRow = (key: string, field: string, value: any) => {
    setGradeRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r));
  };

  const handleCourseSearch = (key: string, query: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!id || query.length < 2) {
      updateRow(key, 'searchResults', []);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchTranscriptCourses(Number(id), query);
        updateRow(key, 'searchResults', results || []);
      } catch {
        updateRow(key, 'searchResults', []);
      }
    }, 400);
  };

  const selectCourse = (key: string, course: any) => {
    const row = gradeRows.find(r => r.key === key);
    if (!row || !course) return;

    const matchingSelection = linkedApplication?.selections?.find((s: any) =>
      (course.id && s.partner_course_id === course.id) ||
      (s.partner_course?.course_code === course.course_code && course.course_code)
    );
    const laHomeIds = matchingSelection
      ? ((matchingSelection.coordinator_override_courses?.length || 0) > 0
          ? matchingSelection.coordinator_override_courses!.map((c: any) => c.id)
          : (matchingSelection.selected_home_course_ids || []))
      : [];

    setGradeRows(prev => prev.map(r =>
      r.key === key ? {
        ...r,
        partner_course_id: course.id || null,
        partner_course_name: course.course_name,
        partner_course_code: course.course_code,
        partner_ects: course.ects,
        is_db_course: !!course.id,
        mapped_home_course_ids: laHomeIds,
        searchResults: [],
      } : r
    ));
  };

  const doPreviewConversion = async (key: string, mode: 'auto_local' | 'auto_ects', grade: string, courseName: string) => {
    if (!id) return;
    const isEcts = mode === 'auto_ects';
    const num = parseFloat(grade.toString().replace(',', '.'));
    const normalized = !isNaN(num) ? num.toString() : grade;

    try {
      const result = await previewConversion(Number(id), {
        local_grade: normalized,
        has_ects: isEcts,
        partner_course_name: courseName,
      });
      setGradeRows(prev => prev.map(r =>
        r.key === key ? {
          ...r,
          ects_grade: result.ects_grade,
          iku_grade: result.iku_grade,
          conversion_method: result.conversion_method,
          grading_scheme_name: (result as any).grading_scheme_name,
        } : r
      ));
    } catch (e: any) {
      message.error(e.response?.data?.detail || t('transcripts.messages.conversionFailed'));
      setGradeRows(prev => prev.map(r =>
        r.key === key ? { ...r, iku_grade: '?', ects_grade: undefined } : r
      ));
    }
  };

  const handlePreviewConversionForKey = (key: string) => {
    setTimeout(() => handlePreviewConversion(key), 0);
  };

  const handlePreviewConversion = async (key: string) => {
    if (!id) return;
    const row = gradeRows.find(r => r.key === key);
    if (!row) return;
    const isEcts = row.conversion_mode === 'auto_ects';
    const inputGrade = isEcts ? row.ects_grade : row.local_grade;
    if (!inputGrade) return;
    await doPreviewConversion(key, row.conversion_mode, inputGrade, row.partner_course_name);
  };

  const handleSaveGrades = async (): Promise<boolean> => {
    if (!id) return false;
    const newRows = gradeRows.filter(r => !r.existing_id);
    const existingRows = gradeRows.filter(r => r.existing_id && (r.local_grade || r.ects_grade || r.iku_grade));

    if (newRows.length === 0 && existingRows.length === 0) {
      message.info(t('transcripts.messages.nothingToSave'));
      return true;
    }

    const hasEmptyName = newRows.some(r => !r.partner_course_name.trim());
    if (hasEmptyName) {
      message.error(t('transcripts.messages.courseNameRequired'));
      return false;
    }

    const hasEmptyGrades = gradeRows.some(r => {
      const isStarted = r.partner_course_name.trim() !== '';
      if (!isStarted) return false;
      if (r.conversion_mode === 'auto_ects') return !r.ects_grade || r.ects_grade.trim() === '';
      return !r.local_grade || r.local_grade.trim() === '';
    });
    if (hasEmptyGrades) {
      message.error(t('transcripts.messages.enterGrades'));
      return false;
    }

    const hasInvalidConversions = gradeRows.some(r => {
      const hasGrade = r.conversion_mode === 'auto_ects' ?
        (r.ects_grade && r.ects_grade.trim() !== '') :
        (r.local_grade && r.local_grade.trim() !== '');
      return hasGrade && (!r.iku_grade || r.iku_grade === '?' || r.iku_grade === '-');
    });
    if (hasInvalidConversions) {
      message.error(t('transcripts.messages.invalidConversions'));
      return false;
    }

    setSaving(true);
    try {
      let savedEntries: TranscriptGradeEntry[] = [];
      if (newRows.length > 0) {
        savedEntries = await saveTranscriptGrades(Number(id), newRows.map(r => ({
          partner_course_id: r.partner_course_id || null,
          partner_course_name: r.partner_course_name,
          partner_course_code: r.partner_course_code || undefined,
          partner_ects: r.partner_ects || undefined,
          local_grade: r.local_grade,
          has_ects: r.conversion_mode === 'auto_ects',
          ects_grade: r.conversion_mode === 'auto_ects' ? (r.ects_grade || undefined) : undefined,
          conversion_mode: r.conversion_mode,
          mapped_home_course_ids: r.mapped_home_course_ids || [],
        })));
      }
      await Promise.all(existingRows.map(row => {
        const updates: Record<string, unknown> = {};
        updates.partner_course_name = row.partner_course_name;
        updates.partner_course_code = row.partner_course_code || null;
        updates.partner_ects = row.partner_ects || null;
        if (row.local_grade) updates.local_grade = row.local_grade;
        if (row.ects_grade) updates.ects_grade = row.ects_grade;
        updates.has_ects = row.conversion_mode === 'auto_ects';
        updates.mapped_home_course_ids = row.mapped_home_course_ids || [];
        return updateTranscriptGradeEntry(Number(id), row.existing_id!, updates);
      }));
      message.success(t('transcripts.messages.saved'));

      const fresh = await getTranscript(Number(id));
      setGradeRows(prev => prev.map(r => {
        if (r.existing_id) {
          const e = (fresh.grade_entries || []).find((ge: any) => ge.id === r.existing_id);
          if (e) return { ...r, partner_course_name: e.partner_course_name, partner_course_code: e.partner_course_code, partner_ects: e.partner_ects, local_grade: e.local_grade || '', ects_grade: e.ects_grade || undefined, iku_grade: e.iku_grade || undefined };
        }
        return r;
      }));
      qc.setQueryData(['transcript', id], fresh);
      return true;
    } catch (e: any) {
      message.error(e.response?.data?.detail || t('transcripts.messages.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    if (!id) return;
    try {
      await deleteTranscriptGradeEntry(Number(id), entryId);
      message.success(t('transcripts.messages.entryDeleted'));
      const fresh = await getTranscript(Number(id));
      qc.setQueryData(['transcript', id], fresh);
      setGradeRows(prev => prev.filter(r => r.existing_id !== entryId));
      if (selectedRowKey === `existing-${entryId}`) {
        setSelectedRowKey(null);
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || t('transcripts.messages.deleteFailed'));
    }
  };

  const handleSubmitReview = async () => {
    if (!id) return;
    if (gradeRows.length === 0) {
      message.error(t('transcripts.messages.emptySubmitError'));
      return;
    }

    // Auto-save changes first
    const saveSuccess = await handleSaveGrades();
    if (!saveSuccess) {
      // Abort submission if saving failed due to validation errors
      return;
    }

    const hasErrors = gradeRows.some(r => !r.iku_grade || r.iku_grade === '?' || r.iku_grade === '-');
    if (hasErrors) {
      message.error(t('transcripts.messages.invalidConversions'));
      return;
    }
    try {
      await submitTranscriptForReview(Number(id));
      message.success(t('studentTranscripts.detail.submitSuccess'));
      qc.invalidateQueries({ queryKey: ['transcript', id] });
      qc.invalidateQueries({ queryKey: ['my-transcripts'] });
    } catch (e: any) {
      message.error(e.response?.data?.detail || t('transcripts.messages.submitFailed'));
    }
  };

  const getExportData = () => {
    return gradeRows.map((record) => {
      const matchingSelection = linkedApplication?.selections?.find((s: any) => {
        if (s.status === 'not_selected' || s.status === 'rejected') return false;
        if (record.partner_course_id && s.partner_course?.id === record.partner_course_id) return true;
        if (record.partner_course_code && s.partner_course?.course_code === record.partner_course_code) return true;
        if (record.partner_course_name && s.partner_course?.course_name?.toLowerCase() === record.partner_course_name.toLowerCase()) return true;
        return false;
      });

      const isOverridden = matchingSelection && (matchingSelection.coordinator_override_courses?.length || 0) > 0;

      const mappedCourses = (record.mapped_home_course_ids && record.mapped_home_course_ids.length > 0)
        ? homeCoursesRes?.courses?.filter((c: any) => record.mapped_home_course_ids?.includes(c.id))
        : null;

      const homeCourses = mappedCourses && mappedCourses.length > 0
        ? mappedCourses
        : (matchingSelection
          ? (isOverridden ? matchingSelection.coordinator_override_courses : (matchingSelection.selected_home_course ? [matchingSelection.selected_home_course] : []))
          : null);

      let homeCourseCode = "-";
      let homeCourseName = "Direct Transfer";
      let homeEcts = "-";
      if (homeCourses && homeCourses.length > 0) {
        homeCourseCode = homeCourses.map((hc: any) => hc.course_code || '').join(', ');
        homeCourseName = homeCourses.map((hc: any) => hc.course_name).join(', ');
        homeEcts = homeCourses.map((hc: any) => String(hc.ects)).join(', ');
      }

      return {
        partnerCode: record.partner_course_code || "-",
        partnerName: record.partner_course_name,
        partnerEcts: record.partner_ects || "-",
        localGrade: record.local_grade,
        ectsGrade: record.ects_grade || "-",
        homeCourseCode,
        homeCourseName,
        homeEcts,
        ikuGrade: record.iku_grade || "-",
      };
    });
  };

  const getExportDataRows = () => {
    const parseEctsSum = (val: any): number => {
      if (val === null || val === undefined) return 0;
      if (typeof val === 'number') return val;
      const str = String(val).trim();
      if (!str) return 0;
      return str.split(/[\s,/_+\-]+/).reduce((sum, part) => {
        const num = parseFloat(part.trim());
        return sum + (isNaN(num) ? 0 : num);
      }, 0);
    };

    const rows = getExportData();
    const totalPartnerEcts = rows.reduce((sum: number, r: any) => sum + parseEctsSum(r.partnerEcts), 0);
    const totalHomeEcts = rows.reduce((sum: number, r: any) => sum + parseEctsSum(r.homeEcts), 0);
    return { rows, totalPartnerEcts, totalHomeEcts };
  };

  const buildTableBody = (showTotals: boolean) => {
    const { rows, totalPartnerEcts, totalHomeEcts } = getExportDataRows();
    const topLabel = t('transcripts.detail.total', 'Toplam');
    const body: any[][] = [];
    rows.forEach((r: any) => {
      body.push([r.partnerCode, r.partnerName, r.localGrade, r.ectsGrade, String(r.partnerEcts),
        r.homeCourseCode, r.homeCourseName, r.ectsGrade, r.ikuGrade, String(r.homeEcts)]);
    });
    if (showTotals) {
      body.push(['', '', '', { text: topLabel, bold: true }, { text: String(totalPartnerEcts), bold: true },
        '', '', '', { text: topLabel, bold: true }, { text: String(totalHomeEcts), bold: true }]);
    }
    return body;
  };

  const handleExportPDF = () => {
    const studentName = transcript?.student_name || transcript?.student_eid || '-';
    const studentId = transcript?.student_eid || '-';
    const partnerUni = transcript?.partner_university_name || '';
    const homeUni = 'İstanbul Kültür Üniversitesi';
    const headers = [
      t('transcripts.detail.dersKodu', 'Ders Kodu'), t('transcripts.detail.dersinAdi', 'Dersin Adı'),
      t('transcripts.detail.transkriptNotuYerel', 'Transkript Notu (Yerel)'), t('transcripts.detail.transkriptNotuAKTS', 'Transkript Notu (AKTS)'), t('transcripts.detail.aktsKredisi', 'AKTS Kredisi'),
      t('transcripts.detail.dersKodu', 'Ders Kodu'), t('transcripts.detail.dersinAdi', 'Dersin Adı'),
      t('transcripts.detail.aktsNotu', 'AKTS Notu'), t('transcripts.detail.ikuNotu', 'İKÜ Notu'), t('transcripts.detail.aktsKredisi', 'AKTS Kredisi'),
    ];

    const docDef = {
      pageSize: 'A4',
      pageOrientation: 'portrait',
      pageMargins: [15, 25, 15, 20],
      content: [
        { text: t('transcripts.detail.transferFormTitle', 'Ders Transfer Formu'), style: 'title' },
        { text: `${t('transcripts.detail.studentName', 'Öğrenci İsmi')}: ${studentName}`, fontSize: 11, margin: [0, 0, 0, 4] },
        { text: `${t('transcripts.detail.studentNumber', 'Öğrenci Numarası')}: ${studentId}`, fontSize: 11, margin: [0, 0, 0, 16] },
        { columns: [
          { text: partnerUni, bold: true, fontSize: 10, alignment: 'left' },
          { text: homeUni, bold: true, fontSize: 10, alignment: 'right' },
        ], margin: [0, 0, 0, 10] },
        { table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto'],
          body: [
            headers.map(h => ({ text: h, bold: true, fontSize: 8, color: 'black', alignment: 'center', margin: [2, 4] })),
            ...buildTableBody(true).map(row => row.map(cell =>
              typeof cell === 'object' ? { ...cell, fontSize: 8, alignment: 'center', margin: [2, 3] }
              : { text: String(cell), fontSize: 8, alignment: 'center', margin: [2, 3] }
            )),
          ],
        }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#999', vLineColor: () => '#999' } },
      ],
      styles: {
        title: { fontSize: 16, bold: true, alignment: 'left', margin: [0, 0, 0, 16] },
      },
    };

    pdfMake.createPdf(docDef as any).download(`${transcript?.student_eid || 'student'}_ders_transfer_formu.pdf`);
  };

  const handleExportDOCX = async () => {
    const studentName = transcript?.student_name || transcript?.student_eid || '-';
    const studentId = transcript?.student_eid || '-';
    const partnerUni = transcript?.partner_university_name || '';
    const homeUni = 'İstanbul Kültür Üniversitesi';
    const { rows, totalPartnerEcts, totalHomeEcts } = getExportDataRows();

    const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
    const cell = (text: string, bold = false, size = 18) =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: String(text), bold, size: size ? size * 1.25 : undefined, font: 'Calibri' })], alignment: AlignmentType.CENTER, spacing: { before: 20, after: 20 } })],
        width: { size: text.length > 20 ? 1600 : 900, type: WidthType.DXA },
        borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
      });

    const headerCell = (text: string) =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: 'Calibri' })], alignment: AlignmentType.CENTER, spacing: { before: 20, after: 20 } })],
        width: { size: text.length > 15 ? 1400 : 800, type: WidthType.DXA },
        borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
      });

    const tableRows: TableRow[] = [];

    // Partner header (cols 0-4) + Home header (cols 5-9)
    tableRows.push(new TableRow({
      children: [
        headerCell(t('transcripts.detail.dersKodu', 'Ders Kodu')),
        headerCell(t('transcripts.detail.dersinAdi', 'Dersin Adı')),
        headerCell(t('transcripts.detail.transkriptNotuYerel', 'Transkript Notu (Yerel)')),
        headerCell(t('transcripts.detail.transkriptNotuAKTS', 'Transkript Notu (AKTS)')),
        headerCell(t('transcripts.detail.aktsKredisi', 'AKTS Kredisi')),
        headerCell(t('transcripts.detail.dersKodu', 'Ders Kodu')),
        headerCell(t('transcripts.detail.dersinAdi', 'Dersin Adı')),
        headerCell(t('transcripts.detail.aktsNotu', 'AKTS Notu')),
        headerCell(t('transcripts.detail.ikuNotu', 'İKÜ Notu')),
        headerCell(t('transcripts.detail.aktsKredisi', 'AKTS Kredisi')),
      ],
    }));

    rows.forEach((r: any) => {
      tableRows.push(new TableRow({
        children: [
          cell(r.partnerCode),
          cell(r.partnerName),
          cell(r.localGrade),
          cell(r.ectsGrade),
          cell(String(r.partnerEcts)),
          cell(r.homeCourseCode),
          cell(r.homeCourseName),
          cell(r.ectsGrade),
          cell(r.ikuGrade),
          cell(String(r.homeEcts)),
        ],
      }));
    });

    // Totals row
    tableRows.push(new TableRow({
      children: [
        cell('', true), cell('', true), cell('', true), cell(t('transcripts.detail.total', 'Toplam'), true),
        cell(String(totalPartnerEcts), true),
        cell('', true), cell('', true), cell('', true), cell(t('transcripts.detail.total', 'Toplam'), true),
        cell(String(totalHomeEcts), true),
      ],
    }));

    const uniHeaderParagraph = new Paragraph({
      children: [
        new TextRun({ text: partnerUni, bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: `\t${homeUni}`, bold: true, size: 22, font: 'Calibri' }),
      ],
      tabStops: [
        {
          type: TabStopType.RIGHT,
          position: TabStopPosition.MAX,
        },
      ],
      spacing: { before: 100, after: 250 },
    });

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: t('transcripts.detail.transferFormTitle', 'Ders Transfer Formu'), bold: true, size: 28, font: 'Calibri' })], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: `${t('transcripts.detail.studentName', 'Öğrenci İsmi')}: ${studentName}`, size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: `${t('transcripts.detail.studentNumber', 'Öğrenci Numarası')}: ${studentId}`, size: 22, font: 'Calibri' })], spacing: { after: 200 } }),
          uniHeaderParagraph,
          new DocxTable({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${transcript?.student_eid || 'student'}_ders_transfer_formu.docx`);
  };

  const handleExportXLSX = async () => {
    const XLSX = await import('xlsx');
    const data = getExportData().map((r: any) => ({
      "Ders Kodu": r.partnerCode,
      "Dersin Adı": r.partnerName,
      "Transkript Notu (Yerel)": r.localGrade,
      "Transkript Notu (AKTS)": r.ectsGrade,
      "AKTS Kredisi": r.partnerEcts,
      "Ders Kodu (İKÜ)": r.homeCourseCode,
      "Dersin Adı (İKÜ)": r.homeCourseName,
      "AKTS Notu": r.ectsGrade,
      "İKÜ Notu": r.ikuGrade,
      "AKTS Kredisi (İKÜ)": r.homeEcts,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ders Transfer Formu");
    XLSX.writeFile(workbook, `${transcript?.student_eid || 'student'}_ders_transfer_formu.xlsx`);
  };

  const isLocked = transcript?.status && !['uploaded', 'student_grading'].includes(transcript.status);

  if (!transcript) return null;

  const schemeInfo = schemes?.find((s: any) => s.university_id === transcript.partner_university_id);

  // ── Grade entry columns ──
  const gradeColumns = [
    {
      title: t('transcripts.gradeTable.courseName'),
      key: 'course_name',
      width: 170,
      ellipsis: true,
      render: (_: any, row: GradeRow) => (
        <AutoComplete
          style={{ width: '100%' }}
          value={row.partner_course_name}
          options={row.searchResults.map((c: any) => ({
            value: c.id || `hist-${c.course_name}-${c.course_code}`,
            label: (
              <div>
                <div style={{ fontWeight: 500 }}>{c.course_name}</div>
                {c.course_code && <div style={{ fontSize: 11, color: '#888' }}>{c.course_code} | {c.ects} {t('courseTable.columns.ects')}</div>}
              </div>
            ),
            courseData: c,
          }))}
          onSearch={(q) => handleCourseSearch(row.key, q)}
          onSelect={(_: any, option: any) => selectCourse(row.key, option.courseData)}
          onChange={(val: string) => {
            updateRow(row.key, 'partner_course_name', val);
            updateRow(row.key, 'partner_course_id', null);
          }}
          placeholder="Search..."
          filterOption={false}
          disabled={isLocked}
        />
      ),
    },
    {
      title: t('transcripts.gradeTable.code'),
      dataIndex: 'partner_course_code',
      key: 'code',
      width: 75,
      render: (val: string | null, row: GradeRow) => (
        <Input value={val || ''} onChange={e => updateRow(row.key, 'partner_course_code', e.target.value)}
          size="small" disabled={isLocked} style={{ width: '100%' }} />
      ),
    },
    {
      title: t('transcripts.gradeTable.ects'),
      dataIndex: 'partner_ects',
      key: 'ects',
      width: 65,
      align: 'center' as const,
      render: (val: number | null, row: GradeRow) => (
        <InputNumber value={val} onChange={v => updateRow(row.key, 'partner_ects', v)}
          size="small" min={0} max={30} step={0.5} style={{ width: '100%' }} disabled={isLocked} />
      ),
    },
    {
      title: t('transcripts.gradeTable.mode'),
      key: 'mode',
      width: 130,
      render: (_: any, row: GradeRow) => (
        <Select
          value={row.conversion_mode}
          onChange={(v: any) => {
            const newMode = v as 'auto_local' | 'auto_ects';
            updateRow(row.key, 'conversion_mode', newMode);
            const grade = newMode === 'auto_ects' ? row.ects_grade : row.local_grade;
            if (grade && grade.trim()) {
              doPreviewConversion(row.key, newMode, grade, row.partner_course_name);
            }
          }}
          size="small"
          style={{ width: '100%' }}
          disabled={isLocked}
          options={[
            { label: t('transcripts.gradeTable.modes.localToIku'), value: 'auto_local' },
            { label: t('transcripts.gradeTable.modes.ectsToIku'), value: 'auto_ects' },
          ]}
        />
      ),
    },
    {
      title: t('transcripts.gradeTable.localGrade'),
      dataIndex: 'local_grade',
      key: 'local_grade',
      width: 90,
      render: (val: string, row: GradeRow) => (
        <Input value={val} onChange={e => updateRow(row.key, 'local_grade', e.target.value)}
          onBlur={() => { if (row.conversion_mode === 'auto_local') handlePreviewConversionForKey(row.key); }}
          size="small" style={{ width: '100%' }} disabled={isLocked} />
      ),
    },
    {
      title: t('transcripts.gradeTable.ectsGrade'),
      dataIndex: 'ects_grade',
      key: 'ects_grade',
      width: 85,
      align: 'center' as const,
      render: (val: string | undefined, row: GradeRow) => (
        <Input value={val || ''} onChange={e => updateRow(row.key, 'ects_grade', e.target.value)}
          onBlur={() => { if (row.conversion_mode === 'auto_ects') handlePreviewConversionForKey(row.key); }}
          placeholder={row.conversion_mode === 'auto_ects' ? 'A, B, C...' : ''}
          size="small" style={{ width: '100%' }} disabled={isLocked || row.conversion_mode === 'auto_local'} />
      ),
    },
    {
      title: t('transcripts.gradeTable.iku'),
      dataIndex: 'iku_grade',
      key: 'iku_grade',
      width: 80,
      align: 'center' as const,
      render: (val: string | undefined, row: GradeRow) => (
        <Space size={2}>
          <Text strong style={{ color: val && val !== '?' ? '#c0392b' : undefined, fontSize: 13 }}>
            {val || '-'}
          </Text>
          {row.conversion_method && (
            <Tooltip title={
              <div>
                {row.conversion_method === 'auto_ects' ? (
                  <div><strong>{t('transcripts.gradeTable.conversionMethod')}:</strong> ECTS → IKU</div>
                ) : row.conversion_method === 'auto_local' ? (
                  <div><strong>{t('transcripts.gradeTable.conversionMethod')}:</strong> {t('transcripts.gradeTable.localToEcts')}</div>
                ) : null}
                {row.grading_scheme_name && <div><strong>{t('transcripts.gradeTable.scheme')}:</strong> {row.grading_scheme_name}</div>}
                {row.grading_scheme_version_number && <div><strong>Scheme Version:</strong> v{row.grading_scheme_version_number}</div>}
                {row.ects_iku_version_number && <div><strong>ECTS-IKU Version:</strong> v{row.ects_iku_version_number}</div>}
              </div>
            }>
              <Button type="link" size="small" icon={<InfoCircleOutlined style={{ fontSize: 11 }} />} style={{ padding: 0, lineHeight: 1 }}
                onClick={async () => {
                  if (row.grading_scheme_id && row.grading_scheme_version_id) {
                    try {
                      const detail = await getSchemeVersion(row.grading_scheme_id, row.grading_scheme_version_id, row.ects_iku_version_id);
                      setVersionDetailData(detail);
                      setSchemeVersionId(row.grading_scheme_version_number ?? null);
                      setEctsIkuVersionId(row.ects_iku_version_number ?? null);
                      setSchemeModalVisible(true);
                    } catch { /* ignore */ }
                  }
                }}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      align: 'right' as const,
      render: (_: any, row: GradeRow) => (
        <Space size={2}>
          {!isLocked && (
            <Button type="link" danger size="small" icon={<DeleteOutlined style={{ fontSize: 14 }} />}
              style={{ padding: '0 4px' }}
              onClick={() => {
                if (row.existing_id) {
                  handleDeleteEntry(row.existing_id!);
                } else {
                  setGradeRows(prev => prev.filter(r => r.key !== row.key));
                  if (selectedRowKey === row.key) setSelectedRowKey(null);
                }
              }} />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={() => navigate('/student-transcripts')}>{t('transcripts.actions.back')}</Button>
          <Title level={4} style={{ margin: 0 }}>
            {t('transcripts.detail.transcript')} — {transcript.partner_university_name || t('transcripts.detail.unknownUniversity')}
          </Title>
          <Tag color={(TRANSCRIPT_STATUS_CONFIG[transcript.status] || {}).color || 'default'}>
            {t((TRANSCRIPT_STATUS_CONFIG[transcript.status] || {}).label || transcript.status || 'Pending')}
          </Tag>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isLocked && transcript.status === 'finalized' && (
            <>
              <Button icon={<FilePdfOutlined />} onClick={handleExportPDF}>
                {t('transcripts.detail.exportPdf')}
              </Button>
              <Button icon={<FileWordOutlined />} onClick={handleExportDOCX}>
                {t('transcripts.detail.exportWord', 'Export Word')}
              </Button>
              <Button icon={<FileExcelOutlined />} onClick={handleExportXLSX}>
                {t('transcripts.detail.exportExcel')}
              </Button>
              <Button type="primary" icon={<EyeOutlined />} onClick={() => setOverviewVisible(true)}
                style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}>
                {t('transcripts.detail.overview')}
              </Button>
            </>
          )}
          {!isLocked && (
            <Popconfirm
              title={t('studentTranscripts.detail.submitConfirm')}
              description={t('studentTranscripts.detail.submitDesc')}
              onConfirm={handleSubmitReview}
              disabled={gradeRows.length === 0 || gradeRows.some(r => !r.iku_grade || r.iku_grade === '?' || r.iku_grade === '-')}
            >
              <Button type="primary" icon={<LockOutlined />}
                disabled={gradeRows.length === 0 || gradeRows.some(r => !r.iku_grade || r.iku_grade === '?' || r.iku_grade === '-')}
                title={gradeRows.some(r => !r.iku_grade || r.iku_grade === '?' || r.iku_grade === '-') ? t('studentTranscripts.detail.fixGradesFirst') : ""}
              >
                {t('studentTranscripts.detail.submitForReview')}
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <Card size="small" style={{ flex: 1 }}>
          <Text type="secondary">{t('transcripts.detail.student')}</Text>
          <div style={{ marginTop: 4 }}>
            <div style={{ fontWeight: 500 }}>{transcript.student_name || `#${transcript.student_id}`}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{transcript.student_eid}</div>
          </div>
        </Card>
        <Card size="small" style={{ flex: 1, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('transcripts.detail.university')}</Text>
              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{transcript.partner_university_name}</div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                  {schemeInfo?.name || t('transcripts.detail.noGradingScheme')} ({schemeInfo?.scheme_type ? t(`gradeConversion.types.${schemeInfo.scheme_type}`) : '-'})
                </div>
              </div>
            </div>
            {schemeInfo && (
              <Button size="small" icon={<BookOutlined />}
                onClick={async () => {
                  setSchemeVersionLoading(true);
                  try {
                    const entryVersionId = transcript.grade_entries?.[0]?.grading_scheme_version_id || transcript.grading_scheme_version_id;
                    const entryEctsVersionId = transcript.grade_entries?.[0]?.ects_iku_version_id || transcript.ects_iku_version_id;
                    let detail;
                    if (entryVersionId) {
                      detail = await getSchemeVersion(schemeInfo.id, entryVersionId, entryEctsVersionId);
                    }
                    if (!detail) {
                      const versions = await getSchemeVersions(schemeInfo.id);
                      if (versions?.[0]?.id) {
                        detail = await getSchemeVersion(schemeInfo.id, versions[0].id, entryEctsVersionId);
                      }
                    }
                    if (detail) {
                      setVersionDetailData(detail);
                      setSchemeVersionId(detail.version_number);
                      setEctsIkuVersionId(detail.ects_iku_version_number ?? null);
                    } else {
                      setVersionDetailData(null);
                      setSchemeVersionId(null);
                      setEctsIkuVersionId(null);
                    }
                  } catch { /* ignore */ }
                  setSchemeVersionLoading(false);
                  setSchemeModalVisible(true);
                }}
                style={{ fontSize: 11, background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4 }}
              >
                {t('transcripts.detail.scheme')}
              </Button>
            )}
          </div>
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Text type="secondary">{t('transcripts.detail.file')}</Text>
          <div style={{ fontWeight: 500 }}>
            {pdfPreviewUrl ? (
              <a href={pdfPreviewUrl} target="_blank" rel="noopener noreferrer">
                <FilePdfOutlined /> {transcript.original_filename}
              </a>
            ) : transcript.original_filename}
          </div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {pdfPreviewUrl && (
          <div style={{ width: '45%', flexShrink: 0 }}>
            <Divider>{t('transcripts.detail.pdfPreview')}</Divider>
            <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden', background: '#fafafa' }}>
              <iframe src={pdfPreviewUrl} style={{ width: '100%', height: 600, border: 'none' }} title="Transcript PDF" />
            </div>
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <Divider>{t('transcripts.detail.gradeEntries')}</Divider>
          <Table
            dataSource={gradeRows}
            columns={gradeColumns}
            rowKey="key"
            pagination={false}
            size="small"
            tableLayout="fixed"
            onRow={(record) => ({
              onClick: () => setSelectedRowKey(record.key),
              style: { cursor: 'pointer', background: selectedRowKey === record.key ? '#f0f7ff' : undefined }
            })}
            footer={() => (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                {!isLocked ? (
                  <Button type="dashed" icon={<PlusOutlined />} onClick={addEmptyRow}>
                    {t('transcripts.actions.addCourse')}
                  </Button>
                ) : <div />}
                {!isLocked && (
                  <Button type="primary" onClick={handleSaveGrades} loading={saving} disabled={gradeRows.length === 0}>
                    {t('transcripts.actions.save')}
                  </Button>
                )}
              </div>
            )}
          />

          {selectedRowKey && (
            <Card size="small" title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><BookOutlined style={{ marginRight: 8, color: '#1890ff' }} />
                  {t('transcripts.matching.title')}: <Text strong>{gradeRows.find(r => r.key === selectedRowKey)?.partner_course_name}</Text>
                </span>
                <Button type="text" size="small" onClick={() => setSelectedRowKey(null)}>×</Button>
              </div>
            }
              style={{ marginTop: 16, border: '1px solid #1890ff', borderRadius: 8 }}>
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>{t('transcripts.matching.description')}</Text>
              </div>
              <Select
                mode="multiple" style={{ width: '100%' }}
                placeholder={t('transcripts.matching.searchPlaceholder')}
                value={gradeRows.find(r => r.key === selectedRowKey)?.mapped_home_course_ids}
                options={homeCourseOptions}
                filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
                onChange={(val) => updateRow(selectedRowKey, 'mapped_home_course_ids', val)}
                disabled={isLocked}
                showSearch size="large" loading={!homeCoursesRes}
              />
            </Card>
          )}
        </div>
      </div>

      {transcript.notes && (
        <>
          <Divider>{t('transcripts.detail.notes')}</Divider>
          <Text>{transcript.notes}</Text>
        </>
      )}

      {/* Overview Modal */}
      <Modal
        title={t('transcripts.overview.title')}
        open={overviewVisible}
        onCancel={() => setOverviewVisible(false)}
        footer={[
          <Button key="pdf" icon={<FilePdfOutlined />} onClick={handleExportPDF}>{t('transcripts.detail.exportPdf')}</Button>,
          <Button key="docx" icon={<FileWordOutlined />} onClick={handleExportDOCX}>{t('transcripts.detail.exportWord', 'Export Word')}</Button>,
          <Button key="xlsx" icon={<FileExcelOutlined />} onClick={handleExportXLSX}>{t('transcripts.detail.exportExcel')}</Button>,
          <Button key="close" type="primary" onClick={() => setOverviewVisible(false)} style={{ background: '#c92a2a', borderColor: '#c92a2a' }}>
            {t('transcripts.actions.close')}
          </Button>
        ]}
        width={800}
      >
        <Table
          dataSource={gradeRows}
          rowKey="key"
          pagination={false}
          columns={[
            {
              title: <Text style={{ fontSize: 11, color: '#888' }}>{t('transcripts.overview.partnerCourse')}</Text>,
              key: 'partner',
              render: (_row: any, record: GradeRow) => (
                <div style={{ padding: '8px 0' }}>
                  <Text strong>{record.partner_course_code || '—'}</Text><br />
                  <Text>{record.partner_course_name}</Text><br />
                  <Space style={{ marginTop: 4 }}>
                    <Tag color="blue">{record.partner_ects || '?'} {t('courseTable.columns.ects')}</Tag>
                    <Tag color="purple">{t('transcripts.overview.local')}: {record.local_grade || '—'}</Tag>
                    {record.ects_grade && <Tag color="magenta">{t('courseTable.columns.ects')}: {record.ects_grade}</Tag>}
                  </Space>
                </div>
              ),
            },
            {
              title: <Text style={{ fontSize: 11, color: '#888' }}>{t('transcripts.overview.homeCourse')}</Text>,
              key: 'home',
              render: (_row: any, record: GradeRow) => {
                const matchingSelection = linkedApplication?.selections?.find((s: any) => {
                  if (s.status === 'not_selected' || s.status === 'rejected') return false;
                  if (record.partner_course_id && s.partner_course?.id === record.partner_course_id) return true;
                  if (record.partner_course_code && s.partner_course?.course_code === record.partner_course_code) return true;
                  if (record.partner_course_name && s.partner_course?.course_name?.toLowerCase() === record.partner_course_name.toLowerCase()) return true;
                  return false;
                });
                const isOverridden = matchingSelection && (matchingSelection.coordinator_override_courses?.length || 0) > 0;
                const mappedCourses = (record.mapped_home_course_ids && record.mapped_home_course_ids.length > 0)
                  ? homeCoursesRes?.courses?.filter((c: any) => record.mapped_home_course_ids!.includes(c.id)) : null;
                const homeCourses = mappedCourses && mappedCourses.length > 0
                  ? mappedCourses
                  : (matchingSelection
                    ? (isOverridden ? matchingSelection.coordinator_override_courses : (matchingSelection.selected_home_course ? [matchingSelection.selected_home_course] : []))
                    : null);

                if (homeCourses && homeCourses.length > 0) {
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {homeCourses.map((hc: any) => (
                        <div key={hc.id} style={{ padding: '8px', background: '#f5f5f5', borderRadius: 6 }}>
                          <Text strong>{hc.course_code || '—'}</Text><br />
                          <Text>{hc.course_name}</Text><br />
                          <Space style={{ marginTop: 4 }}>
                            <Tag color="green" style={{ margin: 0 }}>{hc.ects} {t('courseTable.columns.ects')}</Tag>
                            <Tag color="green" style={{ margin: 0 }}>{t('transcripts.overview.ikuGrade')}: {record.iku_grade || '—'}</Tag>
                            {isOverridden && <Tag color="orange" style={{ margin: 0 }}>{t('transcripts.overview.override')}</Tag>}
                          </Space>
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ padding: '8px', background: '#f5f5f5', borderRadius: 6 }}>
                      <Text strong>{t('transcripts.overview.directTransfer')}</Text><br />
                      <Space style={{ marginTop: 4 }}>
                        <Tag color="green">{t('transcripts.overview.ikuGrade')}: {record.iku_grade || '—'}</Tag>
                      </Space>
                    </div>
                  </div>
                );
              },
            },
          ]}
        />
      </Modal>

      {/* Scheme Version Detail Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ background: '#e6f7ff', padding: '10px 12px', borderRadius: 10, color: '#1890ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BookOutlined style={{ fontSize: 20 }} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2937' }}>{schemeInfo?.name || t('transcripts.detail.scheme')}</div>
              <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 400, marginTop: 2 }}>
                {t('transcripts.scheme.description', { university: transcript.partner_university_name })}
              </div>
            </div>
          </div>
        }
        open={schemeModalVisible}
        onCancel={() => { setSchemeModalVisible(false); setVersionDetailData(null); setSchemeVersionId(null); setEctsIkuVersionId(null); }}
        footer={[
          <Button key="close" type="primary" size="large" style={{ borderRadius: 8, padding: '0 24px' }} onClick={() => { setSchemeModalVisible(false); setVersionDetailData(null); setSchemeVersionId(null); setEctsIkuVersionId(null); }}>
            {t('transcripts.actions.close')}
          </Button>
        ]}
        width={750}
        confirmLoading={schemeVersionLoading}
        style={{ top: 40 }}
      >
        <div style={{ paddingTop: 12, paddingBottom: 4 }}>
          {(schemeVersionId || ectsIkuVersionId || versionDetailData?.senate_decision_ref || versionDetailData?.senate_decision_file) && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {schemeVersionId && (
                    <Tag color="blue" style={{ margin: 0, padding: '4px 10px', borderRadius: 6, fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: '#e0f2fe', color: '#0369a1' }}>
                      <HistoryOutlined /> Scheme v{schemeVersionId}
                    </Tag>
                  )}
                  {ectsIkuVersionId && (
                    <Tag color="cyan" style={{ margin: 0, padding: '4px 10px', borderRadius: 6, fontWeight: 600, fontSize: 13, border: 'none', background: '#cffafe', color: '#0891b2' }}>
                      ECTS-IKU v{ectsIkuVersionId}
                    </Tag>
                  )}
                  {versionDetailData?.senate_decision_ref && (
                    <Tag color="red" icon={<InfoCircleOutlined />} style={{ margin: 0, padding: '4px 10px', borderRadius: 6, fontWeight: 500, fontSize: 13, border: 'none', background: '#fdf2f2', color: '#c0392b' }}>
                      {versionDetailData.senate_decision_ref}
                    </Tag>
                  )}
                </div>
                {versionDetailData?.senate_decision_file && (
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    href={`/api/senate-decisions/${versionDetailData.senate_decision_id}/file`}
                    download={versionDetailData.senate_decision_file}
                    style={{ borderRadius: 8, background: '#c0392b', borderColor: '#c0392b', boxShadow: '0 2px 6px rgba(192, 57, 43, 0.25)', fontWeight: 500 }}
                  >
                    {versionDetailData.senate_decision_file}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div style={{ border: '1px solid #edf2f7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)' }}>
            <Table
              size="middle"
              dataSource={versionDetailData?.rules_snapshot || schemeInfo?.rules || []}
              pagination={false}
              rowKey={(r: any) => r.id || r.local_grade_min || Math.random()}
              columns={[
                {
                  title: <span style={{ fontWeight: 600, color: '#374151' }}>{t('transcripts.scheme.localGrade')}</span>,
                  key: 'local_grade',
                  width: '28%',
                  render: (_: any, record: any) => {
                    if (record.local_grade_exact) return <Text strong style={{ color: '#111827', fontSize: 14 }}>{record.local_grade_exact}</Text>;
                    if (record.local_grade_min !== null && record.local_grade_max !== null) {
                      return <Text strong style={{ color: '#111827', fontSize: 14 }}>{record.local_grade_min} - {record.local_grade_max}</Text>;
                    }
                    return '-';
                  }
                },
                {
                  title: <span style={{ fontWeight: 600, color: '#374151' }}>{t('transcripts.scheme.definition')}</span>,
                  dataIndex: 'local_definition',
                  key: 'local_definition',
                  render: (v: any) => <Text style={{ color: '#4b5563' }}>{v || '-'}</Text>
                },
                {
                  title: <span style={{ fontWeight: 600, color: '#374151' }}>{t('transcripts.scheme.ects')}</span>,
                  dataIndex: 'ects_grade',
                  key: 'ects_grade',
                  width: '22%',
                  align: 'center' as const,
                  render: (v: any) => v ? <Tag color="geekblue" style={{ minWidth: 40, textAlign: 'center', fontWeight: 600, padding: '2px 8px', borderRadius: 6, margin: 0 }}>{v}</Tag> : '-'
                },
                {
                  title: <span style={{ fontWeight: 600, color: '#374151' }}>{t('transcripts.scheme.ikuGrade')}</span>,
                  key: 'iku_grade',
                  width: '22%',
                  align: 'center' as const,
                  render: (_: any, record: any) => {
                    const iku = versionDetailData?.ects_iku_mappings?.find((m: any) => m.ects_grade === record.ects_grade)?.iku_grade || record.iku_grade || ectsIkuMap.find((m: any) => m.ects_grade === record.ects_grade)?.iku_grade;
                    return iku ? <Tag color="success" style={{ minWidth: 40, textAlign: 'center', fontWeight: 600, padding: '2px 8px', borderRadius: 6, margin: 0, background: '#f6ffed', borderColor: '#b7eb8f', color: '#389e0d' }}>{iku}</Tag> : '-';
                  }
                }
              ]}
            />
          </div>

          {schemeInfo?.scheme_type === 'mixed' && (
            <div style={{ marginTop: 16, padding: '14px 18px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <InfoCircleOutlined style={{ color: '#f97316', fontSize: 20, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: '#9a3412', fontSize: 14 }}>{t('transcripts.scheme.mixed')}</div>
                <div style={{ color: '#c2410c', fontSize: 13, marginTop: 2 }}>{t('transcripts.scheme.mixedDesc')}</div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
