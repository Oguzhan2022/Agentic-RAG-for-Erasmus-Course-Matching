import React, { useState, useEffect } from 'react';
import {
  Card, Table, Tabs, Tag, Button, Modal, Form, Input,
  Select, Space, Popconfirm, message, Descriptions, Empty, Drawer, Collapse, Divider, Typography,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined,
  FileTextOutlined, SwapOutlined, HistoryOutlined, CloseOutlined,
  BookOutlined, DownloadOutlined, LinkOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getGradingSchemes, getEctsIkuConversion, deleteGradingScheme,
  deleteGradingRule, addGradingRule, updateGradingRule,
  convertGrade, createGradingScheme, updateGradingScheme,
  getUniversities, updateEctsIkuMapping,
  getSchemeVersions, getSchemeVersion, getEctsIkuVersions, getEctsIkuVersion,
  getSenateDecisions, updateRulesBatch, updateEctsIkuBatch, linkVersionToDecision,
} from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { GradingScheme, GradeConversionRule } from '../types';

const ECTS_COLORS: Record<string, string> = {
  A: 'green', B: 'cyan', C: 'blue', D: 'orange', E: 'gold', F: 'red',
  FX: 'red', P: 'purple', Fail: 'volcano',
};

const ECTS_SORT_ORDER: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, FX: 6, F: 7, P: 8, Fail: 9,
};

const GradeConversionPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [ruleForm] = Form.useForm();
  const [testForm] = Form.useForm();
  const { activeDepartment, user, hasRole } = useAuth();
  const isSuperAdmin = user?.is_admin || false;
  const isReadonlyRegistrar = hasRole('registrar_staff') && !hasRole('super_admin') && !hasRole('dept_admin');

  const [selectedScheme, setSelectedScheme] = useState<GradingScheme | null>(null);

  const [senateDrawerVisible, setSenateDrawerVisible] = useState(false);

  const { data: senateDecisions = [], isLoading: senateLoading } = useQuery({
    queryKey: ['senate-decisions-gradeconv', activeDepartment, selectedScheme?.university_id],
    queryFn: () => getSenateDecisions(
      selectedScheme?.university_id
        ? { university_id: selectedScheme.university_id }
        : (activeDepartment ? { department_code: activeDepartment } : {})
    ),
    enabled: senateDrawerVisible,
  });

  const [versionDecisionLinks, setVersionDecisionLinks] = useState<Record<number, number | null>>({});
  const [loadingVersionLink, setLoadingVersionLink] = useState<number | null>(null);

  useEffect(() => {
    if (senateDrawerVisible && selectedScheme) {
      getSchemeVersions(selectedScheme.id).then(list => {
        setSchemeVersionsList(list || []);
        const links: Record<number, number | null> = {};
        (list || []).forEach((v: any) => {
          links[v.id] = v.senate_decision_id;
        });
        setVersionDecisionLinks(links);
      }).catch(() => {});
    }
  }, [senateDrawerVisible, selectedScheme]);

  const handleLinkVersion = async (versionId: number | undefined, senate_decision_id: number | null) => {
    if (!selectedScheme) return;
    if (!versionId) {
      // Unlink the version currently linked to this decision
      const oldVid = Object.keys(versionDecisionLinks).find(vid => versionDecisionLinks[Number(vid)] === senate_decision_id);
      if (oldVid) {
        setLoadingVersionLink(Number(oldVid));
        try {
          await linkVersionToDecision(selectedScheme.id, Number(oldVid), null);
          setVersionDecisionLinks(prev => ({ ...prev, [Number(oldVid)]: null }));
          message.success(t('gradeConversion.decision.unlinked') || 'Version unlinked from decision');
          queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
        } catch (err: any) {
          message.error(err.response?.data?.detail || t('gradeConversion.messages.saveFailed'));
        }
        setLoadingVersionLink(null);
      }
      return;
    }
    setLoadingVersionLink(versionId);
    try {
      await linkVersionToDecision(selectedScheme.id, versionId, senate_decision_id);
      setVersionDecisionLinks(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(k => {
          if (updated[Number(k)] === senate_decision_id) {
            updated[Number(k)] = null;
          }
        });
        updated[versionId] = senate_decision_id;
        return updated;
      });
      message.success(senate_decision_id
        ? t('gradeConversion.messages.decisionLinked')
        : t('gradeConversion.decision.unlinked'));
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    } catch (err: any) {
      message.error(err.response?.data?.detail || t('gradeConversion.messages.saveFailed'));
    }
    setLoadingVersionLink(null);
  };

  const [activeTab, setActiveTab] = useState('schemes');
  const [schemeModalOpen, setSchemeModalOpen] = useState(false);
  const [editingScheme, setEditingScheme] = useState<GradingScheme | null>(null);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<GradeConversionRule | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [ectsIkuModalOpen, setEctsIkuModalOpen] = useState(false);
  const [editingEctsIku, setEditingEctsIku] = useState<{id: number, ects_grade: string, iku_grade: string} | null>(null);
  const [ectsIkuForm] = Form.useForm();
  const [schemeVersionsModal, setSchemeVersionsModal] = useState(false);
  const [schemeVersionsList, setSchemeVersionsList] = useState<any[]>([]);
  const [schemeVersionDetail, setSchemeVersionDetail] = useState<any>(null);
  const [schemeVersionLoading, setSchemeVersionLoading] = useState(false);
  const [schemeVersionSchemeId, setSchemeVersionSchemeId] = useState<number | null>(null);

  const [ectsIkuVersionsModal, setEctsIkuVersionsModal] = useState(false);
  const [ectsIkuVersionsList, setEctsIkuVersionsList] = useState<any[]>([]);
  const [ectsIkuVersionDetail, setEctsIkuVersionDetail] = useState<any>(null);
  const [ectsIkuVersionLoading, setEctsIkuVersionLoading] = useState(false);

  // Batch edit mode: Rules tab
  const [isEditingRules, setIsEditingRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<GradeConversionRule[]>([]);
  const [rulesOriginal, setRulesOriginal] = useState<GradeConversionRule[]>([]);

  // Batch edit mode: ECTS-IKU tab
  const [isEditingEctsIku, setIsEditingEctsIku] = useState(false);
  const [ectsIkuDraft, setEctsIkuDraft] = useState<{ id: number; ects_grade: string; iku_grade: string }[]>([]);
  const [ectsIkuOriginal, setEctsIkuOriginal] = useState<{ id: number; ects_grade: string; iku_grade: string }[]>([]);

  const goToRules = (scheme: GradingScheme) => {
    setSelectedScheme(scheme);
    setActiveTab('rules');
  };

  const { data: schemes = [], isLoading: schemesLoading } = useQuery({
    queryKey: ['grading-schemes', activeDepartment],
    queryFn: () => getGradingSchemes({ department_code: activeDepartment }),
  });

  const { data: ectsIku = [] } = useQuery({
    queryKey: ['ects-iku'],
    queryFn: getEctsIkuConversion,
  });

  const { data: universities = [] } = useQuery({
    queryKey: ['universities', activeDepartment],
    queryFn: () => getUniversities(activeDepartment),
  });

  const deleteSchemeMut = useMutation({
    mutationFn: deleteGradingScheme,
    onSuccess: () => {
      message.success(t('gradeConversion.actions.deleteSchemeConfirm')); // Reuse delete confirm label or add dedicated success
      setSelectedScheme(null);
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Delete failed';
      message.error(detail);
    },
  });

  const deleteRuleMut = useMutation({
    mutationFn: deleteGradingRule,
    onSuccess: () => {
      message.success(t('gradeConversion.actions.deleteRuleConfirm'));
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    },
  });

  const addRuleMut = useMutation({
    mutationFn: (data: { schemeId: number; body: Record<string, unknown> }) =>
      addGradingRule(data.schemeId, data.body),
    onSuccess: () => {
      message.success(t('gradeConversion.actions.addRule'));
      setRuleModalOpen(false);
      ruleForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed';
      message.error(detail);
    },
  });

  const updateRuleMut = useMutation({
    mutationFn: (data: { ruleId: number; body: Record<string, unknown> }) =>
      updateGradingRule(data.ruleId, data.body),
    onSuccess: () => {
      message.success(t('gradeConversion.actions.editRule'));
      setRuleModalOpen(false);
      setEditingRule(null);
      ruleForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    },
  });

  const createSchemeMut = useMutation({
    mutationFn: createGradingScheme,
    onSuccess: () => {
      message.success(t('gradeConversion.actions.newScheme'));
      setSchemeModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed';
      message.error(detail);
    },
  });

  const updateSchemeMut = useMutation({
    mutationFn: (data: { id: number; body: Record<string, unknown> }) =>
      updateGradingScheme(data.id, data.body),
    onSuccess: () => {
      message.success(t('gradeConversion.actions.editScheme'));
      setSchemeModalOpen(false);
      setEditingScheme(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    },
  });

  const convertMut = useMutation({
    mutationFn: convertGrade,
    onSuccess: (data) => {
      setTestResult(data);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Conversion failed';
      message.error(detail);
      setTestResult(null);
    },
  });

  const updateEctsIkuMut = useMutation({
    mutationFn: (data: { id: number; body: { iku_grade: string } }) =>
      updateEctsIkuMapping(data.id, data.body),
    onSuccess: () => {
      message.success('Mapping updated');
      setEctsIkuModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['ects-iku'] });
    },
  });

  const batchRulesMut = useMutation({
    mutationFn: (data: { schemeId: number; rules: any[] }) =>
      updateRulesBatch(data.schemeId, data.rules),
    onSuccess: () => {
      message.success(t('gradeConversion.messages.batchSaved'));
      setIsEditingRules(false);
      setRulesDraft([]);
      setRulesOriginal([]);
      queryClient.invalidateQueries({ queryKey: ['grading-schemes'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('gradeConversion.messages.saveFailed')),
  });

  const batchEctsIkuMut = useMutation({
    mutationFn: (mappings: { ects_grade: string; iku_grade: string }[]) =>
      updateEctsIkuBatch(mappings),
    onSuccess: () => {
      message.success(t('gradeConversion.messages.batchSaved'));
      setIsEditingEctsIku(false);
      setEctsIkuDraft([]);
      setEctsIkuOriginal([]);
      queryClient.invalidateQueries({ queryKey: ['ects-iku'] });
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      let msg: string;
      if (Array.isArray(detail)) {
        msg = detail.map((d: any) => d.msg || d.loc?.join('.')).join(', ');
      } else if (typeof detail === 'string') {
        msg = detail;
      } else {
        msg = t('gradeConversion.messages.saveFailed');
      }
      message.error(msg);
    },
  });

  const handleSchemeSubmit = () => {
    form.validateFields().then((values) => {
      const { copy_from, ...schemeData } = values;
      if (editingScheme) {
        updateSchemeMut.mutate({ id: editingScheme.id, body: schemeData });
      } else {
        let rules: Record<string, unknown>[] = [];
        if (copy_from) {
          const source = schemes.find((s: GradingScheme) => s.id === copy_from);
          if (source?.rules) {
            rules = source.rules.map((r: GradeConversionRule) => ({
              local_grade_min: r.local_grade_min,
              local_grade_max: r.local_grade_max,
              local_grade_exact: r.local_grade_exact,
              local_definition: r.local_definition,
              ects_grade: r.ects_grade,
              description: r.description,
              sort_order: r.sort_order,
            }));
          }
        }
        createSchemeMut.mutate({ ...schemeData, rules });
      }
    });
  };

  const handleRuleSubmit = () => {
    ruleForm.validateFields().then((values) => {
      const sortOrder = ECTS_SORT_ORDER[values.ects_grade] || 99;
      const payload: any = { ...values, sort_order: sortOrder };

      if (isEditingRules) {
        // Batch edit mode: mutate draft locally
        if (editingRule) {
          setRulesDraft(prev => prev.map(r =>
            r.id === editingRule.id ? { ...r, ...payload } : r
          ));
        } else {
          const draftId = -(Date.now()); // temporary negative id for draft
          setRulesDraft(prev => [...prev, { id: draftId, ...payload }]);
        }
        setRuleModalOpen(false);
        setEditingRule(null);
        ruleForm.resetFields();
        return;
      }

      if (editingRule) {
        updateRuleMut.mutate({ ruleId: editingRule.id, body: payload });
      } else if (selectedScheme) {
        addRuleMut.mutate({ schemeId: selectedScheme.id, body: payload });
      }
    });
  };

  const handleRulesSave = () => {
    if (!selectedScheme) return;
    // Send rules without temporary negative IDs
    const rulesToSend = rulesDraft.map(r => {
      const { ...rest } = r as any;
      if (rest.id < 0) delete rest.id;
      return rest;
    });
    batchRulesMut.mutate({ schemeId: selectedScheme.id, rules: rulesToSend });
  };

  const handleRulesCancel = () => {
    setIsEditingRules(false);
    setRulesDraft([]);
    setRulesOriginal([]);
  };

  const startEditRules = () => {
    if (!selectedScheme?.rules) return;
    const clone = JSON.parse(JSON.stringify(selectedScheme.rules));
    setRulesOriginal(clone);
    setRulesDraft(JSON.parse(JSON.stringify(clone)));
    setIsEditingRules(true);
  };

  const handleEctsIkuSave = () => {
    batchEctsIkuMut.mutate(ectsIkuDraft.map(m => ({ ects_grade: m.ects_grade, iku_grade: m.iku_grade })));
  };

  const handleEctsIkuCancel = () => {
    setIsEditingEctsIku(false);
    setEctsIkuDraft([]);
    setEctsIkuOriginal([]);
  };

  const startEditEctsIku = () => {
    const clone = JSON.parse(JSON.stringify(ectsIku));
    setEctsIkuOriginal(clone);
    setEctsIkuDraft(JSON.parse(JSON.stringify(clone)));
    setIsEditingEctsIku(true);
  };

  const handleTestConvert = () => {
    testForm.validateFields().then((values) => {
      convertMut.mutate(values);
    });
  };

  const openEditScheme = (scheme: GradingScheme) => {
    setEditingScheme(scheme);
    form.setFieldsValue(scheme);
    setSchemeModalOpen(true);
  };

  const openAddScheme = () => {
    setEditingScheme(null);
    form.resetFields();
    setSchemeModalOpen(true);
  };

  const openEditRule = (rule: GradeConversionRule) => {
    if (isEditingRules) {
      // In batch edit mode, edit draft locally
      setEditingRule(rule);
      ruleForm.setFieldsValue(rule);
      setRuleModalOpen(true);
      return;
    }
    setEditingRule(rule);
    ruleForm.setFieldsValue(rule);
    setRuleModalOpen(true);
  };

  const openAddRule = () => {
    if (isEditingRules) {
      // In batch edit mode, add to draft
      setEditingRule(null);
      ruleForm.resetFields();
      setRuleModalOpen(true);
      return;
    }
    setEditingRule(null);
    ruleForm.resetFields();
    setRuleModalOpen(true);
  };

  const handleRuleDelete = (ruleId: number) => {
    if (isEditingRules) {
      setRulesDraft(prev => prev.filter(r => r.id !== ruleId));
      return;
    }
    deleteRuleMut.mutate(ruleId);
  };

  const universityOptions = universities
    .filter(u => !u.is_home)
    .map(u => ({ id: u.id, name: u.name }));

  const schemeColumns = [
    {
      title: t('gradeConversion.columns.university'),
      dataIndex: 'university_name',
      key: 'university_name',
      width: '40%',
    },
    {
      title: t('gradeConversion.columns.scheme'),
      dataIndex: 'name',
      key: 'name',
      width: '25%',
    },
    {
      title: t('gradeConversion.columns.type'),
      dataIndex: 'scheme_type',
      key: 'scheme_type',
      width: 130,
      render: (v: string) => <Tag>{t(`gradeConversion.types.${v}`)}</Tag>,
    },
    {
      title: t('gradeConversion.columns.rules'),
      key: 'rules_count',
      width: 70,
      render: (_: unknown, r: GradingScheme) => r.rules?.length || 0,
    },
    {
      title: t('gradeConversion.columns.actions'),
      key: 'actions',
      width: 200,
      render: (_: unknown, r: GradingScheme) => (
        <Space>
          {true && <Button icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openEditScheme(r); }} />}
          <Button type="primary" icon={<FileTextOutlined />} onClick={(e) => { e.stopPropagation(); goToRules(r); }} />
          <Button icon={<HistoryOutlined />} onClick={async (e) => {
            e.stopPropagation();
            setSchemeVersionSchemeId(r.id);
            setSchemeVersionDetail(null);
            setSchemeVersionLoading(true);
            setSchemeVersionsModal(true);
            try {
              const list = await getSchemeVersions(r.id);
              setSchemeVersionsList(list || []);
            } catch { setSchemeVersionsList([]); }
            setSchemeVersionLoading(false);
          }} />
          {true && (
            <Popconfirm title={t('gradeConversion.actions.deleteSchemeConfirm')} onConfirm={() => deleteSchemeMut.mutate(r.id)}>
              <Button danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const sortedRules = (rules: GradeConversionRule[]) =>
    [...rules].sort((a, b) => (ECTS_SORT_ORDER[a.ects_grade] || 99) - (ECTS_SORT_ORDER[b.ects_grade] || 99));

  const ruleColumns = [
    {
      title: t('gradeConversion.columns.localGrade'),
      key: 'local_grade',
      width: 150,
      render: (_: unknown, r: GradeConversionRule) => {
        if (r.local_grade_exact) return <Tag>{r.local_grade_exact}</Tag>;
        return <span>{r.local_grade_min} — {r.local_grade_max}</span>;
      },
    },
    {
      title: t('gradeConversion.columns.definition'),
      dataIndex: 'local_definition',
      key: 'local_definition',
      render: (v: string) => v || '-',
    },
    {
      title: t('gradeConversion.columns.ects'),
      dataIndex: 'ects_grade',
      key: 'ects_grade',
      width: 80,
      render: (v: string) => <Tag color={ECTS_COLORS[v] || 'default'}>{v}</Tag>,
    },
    {
      title: t('gradeConversion.columns.description'),
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => v || '-',
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, r: GradeConversionRule) => (
        isEditingRules ? (
          <Space>
            <Button icon={<EditOutlined />} onClick={() => openEditRule(r)} />
            <Popconfirm title={t('gradeConversion.actions.deleteRuleConfirm')} onConfirm={() => handleRuleDelete(r.id)}>
              <Button danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ) : null
      ),
    },
  ];

  const ectsIkuColumns = [
    { title: t('gradeConversion.columns.ects'), dataIndex: 'ects_grade', key: 'ects_grade', render: (v: string) => <Tag color={ECTS_COLORS[v] || 'default'}>{v}</Tag> },
    { title: t('gradeConversion.columns.ikuGrade'), dataIndex: 'iku_grade', key: 'iku_grade', render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    {
      title: t('gradeConversion.columns.actions'),
      key: 'actions',
      width: 80,
      render: (_: any, r: any) => (
        isEditingEctsIku ? (
          <Button icon={<EditOutlined />} onClick={() => {
            setEditingEctsIku(r);
            ectsIkuForm.setFieldsValue({ iku_grade: r.iku_grade });
            setEctsIkuModalOpen(true);
          }} />
        ) : null
      ),
    },
  ];

  const currentScheme = selectedScheme
    ? schemes.find((s: GradingScheme) => s.id === selectedScheme.id) || null
    : null;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{t('gradeConversion.title')}</h2>
        <Button type="dashed" icon={<BookOutlined />} onClick={() => setSenateDrawerVisible(true)}>
          {t('senateDecisions.title')}
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'schemes',
            label: t('gradeConversion.tabs.schemes'),
            children: (
              <Card>
                <div style={{ marginBottom: 20 }}>
                  {true && (
                    <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openAddScheme} style={{ background: '#c92a2a', borderColor: '#c92a2a', borderRadius: 6, fontWeight: 500 }}>
                      {t('gradeConversion.actions.newScheme')}
                    </Button>
                  )}
                </div>
                <Table
                  dataSource={schemes}
                  columns={schemeColumns}
                  rowKey="id"
                  loading={schemesLoading}
                  pagination={{ pageSize: 15 }}
                  size="middle"
                  onRow={(record) => ({
                    onClick: () => setSelectedScheme(record),
                    style: { cursor: 'pointer', background: currentScheme?.id === record.id ? '#e6f7ff' : undefined },
                  })}
                />
              </Card>
            ),
          },
          {
            key: 'rules',
            label: currentScheme ? `${t('gradeConversion.tabs.rules')}: ${currentScheme.name}` : t('gradeConversion.tabs.rules'),
            children: currentScheme ? (
              <Card
                title={
                  <Space>
                    <span>{currentScheme.university_name} — {currentScheme.name}</span>
                    <Tag>{t(`gradeConversion.types.${currentScheme.scheme_type}`)}</Tag>
                  </Space>
                }
                extra={
                  true ? (
                    isEditingRules ? (
                      <Space>
                        <Button type="primary" icon={<PlusOutlined />} onClick={openAddRule} style={{ background: '#c92a2a', borderColor: '#c92a2a' }}>
                          {t('gradeConversion.actions.addRule')}
                        </Button>
                        <Button onClick={handleRulesSave} type="primary" loading={batchRulesMut.isPending}>
                          {t('common.save')}
                        </Button>
                        <Button onClick={handleRulesCancel}>{t('common.cancel')}</Button>
                      </Space>
                    ) : (
                      <Button icon={<EditOutlined />} onClick={startEditRules}>
                        {t('common.edit')}
                      </Button>
                    )
                  ) : undefined
                }
              >
                <Table
                  dataSource={sortedRules(isEditingRules ? rulesDraft : (currentScheme.rules || []))}
                  columns={ruleColumns}
                  rowKey={(r: any) => String(r.id)}
                  pagination={false}
                  size="middle"
                />
              </Card>
            ) : (
              <Card>
                <Empty description={t('gradeConversion.values.emptyRules')} />
              </Card>
            ),
          },
          {
            key: 'ects-iku',
            label: t('gradeConversion.tabs.ectsIku'),
            children: (
              <Card title={t('gradeConversion.tabs.ectsIku')}
                extra={
                  isSuperAdmin ? (
                    isEditingEctsIku ? (
                      <Space>
                        <Button onClick={handleEctsIkuSave} type="primary" loading={batchEctsIkuMut.isPending}>
                          {t('common.save')}
                        </Button>
                        <Button onClick={handleEctsIkuCancel}>{t('common.cancel')}</Button>
                      </Space>
                    ) : (
                      <Space>
                        <Button icon={<EditOutlined />} onClick={startEditEctsIku}>
                          {t('common.edit')}
                        </Button>
                        <Button icon={<HistoryOutlined />} onClick={async () => {
                          setEctsIkuVersionDetail(null);
                          setEctsIkuVersionLoading(true);
                          setEctsIkuVersionsModal(true);
                          try {
                            const list = await getEctsIkuVersions();
                            setEctsIkuVersionsList(list || []);
                          } catch { setEctsIkuVersionsList([]); }
                          setEctsIkuVersionLoading(false);
                        }}>
                          {t('gradeConversion.versions.title')}
                        </Button>
                      </Space>
                    )
                  ) : (
                    <Button icon={<HistoryOutlined />} onClick={async () => {
                      setEctsIkuVersionDetail(null);
                      setEctsIkuVersionLoading(true);
                      setEctsIkuVersionsModal(true);
                      try {
                        const list = await getEctsIkuVersions();
                        setEctsIkuVersionsList(list || []);
                      } catch { setEctsIkuVersionsList([]); }
                      setEctsIkuVersionLoading(false);
                    }}>
                      {t('gradeConversion.versions.title')}
                    </Button>
                  )
                }>
                <Table
                  dataSource={isEditingEctsIku ? ectsIkuDraft : ectsIku}
                  columns={ectsIkuColumns}
                  rowKey={(r: any) => String(r.id)}
                  pagination={false}
                  size="middle"
                />
              </Card>
            ),
          },
          {
            key: 'test',
            label: t('gradeConversion.tabs.test'),
            icon: <ExperimentOutlined />,
            children: (
              <Card title={t('gradeConversion.tabs.test')}>
                <Form form={testForm} layout="inline" style={{ marginBottom: 24 }}>
                  <Form.Item name="local_grade" rules={[{ required: true, message: t('login.form.usernameRequired') }]}>
                    <Input placeholder={t('gradeConversion.placeholders.grade')} style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item name="university_id" rules={[{ required: true, message: t('gradeConversion.placeholders.selectUniversity') }]}>
                    <Select placeholder={t('gradeConversion.fields.university')} style={{ width: 300 }} showSearch optionFilterProp="children">
                      {universityOptions.map((u: { id: number; name: string }) => (
                        <Select.Option key={u.id} value={u.id}>{u.name}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item name="has_ects" valuePropName="checked" initialValue={false}>
                    <Tag color="purple" style={{ cursor: 'pointer' }}>{t('gradeConversion.fields.ectsGrade')}</Tag>
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" icon={<SwapOutlined />} onClick={handleTestConvert} loading={convertMut.isPending}>
                      {t('gradeConversion.actions.convert')}
                    </Button>
                  </Form.Item>
                </Form>

                {testResult && (
                  <Descriptions bordered size="small" column={1} style={{ maxWidth: 500 }}>
                    <Descriptions.Item label={t('gradeConversion.values.inputGrade')}>{String(testResult.input_grade)}</Descriptions.Item>
                    <Descriptions.Item label={t('gradeConversion.values.inputType')}>{String(testResult.input_type)}</Descriptions.Item>
                    <Descriptions.Item label={t('gradeConversion.fields.ectsGrade')}>
                      <Tag color={ECTS_COLORS[String(testResult.ects_grade)] || 'default'}>
                        {String(testResult.ects_grade)}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label={t('gradeConversion.fields.ikuGrade')}>
                      <Tag color="geekblue" style={{ fontSize: 16, padding: '2px 12px' }}>
                        {String(testResult.iku_grade)}
                      </Tag>
                    </Descriptions.Item>
                    {!!testResult.scheme_name && (
                      <Descriptions.Item label={t('gradeConversion.values.schemeUsed')}>{String(testResult.scheme_name)}</Descriptions.Item>
                    )}
                    <Descriptions.Item label={t('gradeConversion.values.path')}>{String(testResult.conversion_path)}</Descriptions.Item>
                  </Descriptions>
                )}
              </Card>
            ),
          },
        ]}
      />

      {/* Scheme Create/Edit Modal */}
      <Modal
        title={editingScheme ? t('gradeConversion.actions.editScheme') : t('gradeConversion.actions.newScheme')}
        open={schemeModalOpen}
        onOk={handleSchemeSubmit}
        onCancel={() => { setSchemeModalOpen(false); setEditingScheme(null); form.resetFields(); }}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={createSchemeMut.isPending || updateSchemeMut.isPending}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="university_id" label={t('gradeConversion.fields.university')} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="children" placeholder={t('gradeConversion.placeholders.selectUniversity')}>
              {universityOptions.map((u: { id: number; name: string }) => (
                <Select.Option key={u.id} value={u.id}>{u.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="name" label={t('gradeConversion.fields.schemeName')} rules={[{ required: true }]}>
            <Input placeholder={t('gradeConversion.placeholders.schemeName')} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="scheme_type" label={t('gradeConversion.fields.type')} rules={[{ required: true }]}>
              <Select style={{ width: 200 }}>
                <Select.Option value="numeric_range">{t('gradeConversion.types.numeric_range')}</Select.Option>
                <Select.Option value="numeric_discrete">{t('gradeConversion.types.numeric_discrete')}</Select.Option>
                <Select.Option value="letter">{t('gradeConversion.types.letter')}</Select.Option>
                <Select.Option value="custom">{t('gradeConversion.types.custom')}</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="grade_direction" label={t('gradeConversion.fields.direction')}>
              <Select style={{ width: 200 }} allowClear>
                <Select.Option value="asc">{t('gradeConversion.values.higherBetter')}</Select.Option>
                <Select.Option value="desc">{t('gradeConversion.values.lowerBetter')}</Select.Option>
              </Select>
            </Form.Item>
          </Space>
          <Form.Item name="copy_from" label={t('gradeConversion.fields.copyFrom')}>
            <Select 
              allowClear 
              placeholder={t('gradeConversion.placeholders.copyFrom')} 
              showSearch 
              optionFilterProp="children"
              onChange={(val) => {
                if (val) {
                  const source = schemes.find((s: GradingScheme) => s.id === val);
                  if (source) {
                    form.setFieldsValue({
                      name: source.name,
                      scheme_type: source.scheme_type,
                      grade_direction: source.grade_direction,
                    });
                  }
                }
              }}
            >
              {schemes.map((s: GradingScheme) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.university_name} — {s.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="notes" label={t('gradeConversion.fields.notes')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Rule Create/Edit Modal */}
      <Modal
        title={editingRule ? t('gradeConversion.actions.editRule') : t('gradeConversion.actions.addRule')}
        open={ruleModalOpen}
        onOk={handleRuleSubmit}
        onCancel={() => { setRuleModalOpen(false); setEditingRule(null); ruleForm.resetFields(); }}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={addRuleMut.isPending || updateRuleMut.isPending}
        width={500}
      >
        <Form form={ruleForm} layout="vertical">
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="local_grade_min" label={t('gradeConversion.fields.minGrade')}>
              <Input placeholder="e.g. 1.0" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="local_grade_max" label={t('gradeConversion.fields.maxGrade')}>
              <Input placeholder="e.g. 1.5" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="local_grade_exact" label={t('gradeConversion.fields.exactGrade')}>
              <Input placeholder="e.g. 5.0, BE" style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="ects_grade" label={t('gradeConversion.fields.ectsGrade')} rules={[{ required: true }]}>
            <Select style={{ width: 150 }}>
              {['A', 'B', 'C', 'D', 'E', 'FX', 'F', 'P', 'Fail'].map(g => (
                <Select.Option key={g} value={g}>{g}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="local_definition" label={t('gradeConversion.fields.localDefinition')}>
            <Input placeholder={t('gradeConversion.placeholders.localDefinition')} />
          </Form.Item>
          <Form.Item name="description" label={t('gradeConversion.fields.description')}>
            <Input placeholder={t('gradeConversion.placeholders.description')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ECTS to IKU Edit Modal */}
      <Modal
        title={`${t('gradeConversion.actions.editRule')} (IKU Mapping) - ECTS ${editingEctsIku?.ects_grade}`}
        open={ectsIkuModalOpen}
        onOk={() => {
          ectsIkuForm.validateFields().then(values => {
            if (editingEctsIku) {
              if (isEditingEctsIku) {
                // Batch edit mode: mutate draft locally
                setEctsIkuDraft(prev => prev.map(m =>
                  m.id === editingEctsIku.id ? { ...m, iku_grade: values.iku_grade } : m
                ));
                setEctsIkuModalOpen(false);
                setEditingEctsIku(null);
              } else {
                updateEctsIkuMut.mutate({ id: editingEctsIku.id, body: values });
              }
            }
          });
        }}
        onCancel={() => setEctsIkuModalOpen(false)}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={updateEctsIkuMut.isPending}
      >
        <Form form={ectsIkuForm} layout="vertical">
          <Form.Item name="iku_grade" label={t('gradeConversion.fields.ikuGrade')} rules={[{ required: true }]}>
            <Select placeholder={t('gradeConversion.placeholders.ikuGrade')}>
              {['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F', 'Y', 'Z'].map(g => (
                <Select.Option key={g} value={g}>{g}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Scheme Version History Modal */}
      <Modal
        title={t('gradeConversion.versions.title')}
        open={schemeVersionsModal}
        onCancel={() => { setSchemeVersionsModal(false); setSchemeVersionDetail(null); setSchemeVersionsList([]); }}
        footer={<Button onClick={() => { setSchemeVersionsModal(false); setSchemeVersionDetail(null); setSchemeVersionsList([]); }}>{t('gradeConversion.versions.close')}</Button>}
        width={700}
        confirmLoading={schemeVersionLoading}
      >
        {schemeVersionDetail ? (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Button type="link" onClick={() => setSchemeVersionDetail(null)} style={{ padding: 0 }}>
                ← {t('gradeConversion.versions.title')}
              </Button>
              <Tag style={{ marginLeft: 8 }} color="blue">{t('gradeConversion.versions.versionNumber', { num: schemeVersionDetail.version_number })}</Tag>
            </div>
            <Table
              size="small"
              dataSource={schemeVersionDetail.rules_snapshot || []}
              pagination={false}
              rowKey={(r: any, i?: number) => r.id ?? i ?? Math.random()}
              columns={[
                {
                  title: t('gradeConversion.columns.localGrade'),
                  key: 'local_grade',
                  render: (_: any, r: any) => {
                    if (r.local_grade_exact) return <Tag>{r.local_grade_exact}</Tag>;
                    return <span>{r.local_grade_min} — {r.local_grade_max}</span>;
                  },
                },
                { title: t('gradeConversion.columns.definition'), dataIndex: 'local_definition', key: 'local_definition', render: (v: string) => v || '-' },
                { title: t('gradeConversion.columns.ects'), dataIndex: 'ects_grade', key: 'ects_grade', render: (v: string) => <Tag color={ECTS_COLORS[v] || 'default'}>{v}</Tag> },
              ]}
            />
          </div>
        ) : (
          <Table
            size="small"
            dataSource={schemeVersionsList}
            pagination={false}
            loading={schemeVersionLoading}
            rowKey="id"
            locale={{ emptyText: t('gradeConversion.versions.noVersions') }}
            columns={[
              { title: t('gradeConversion.versions.versionNumber', { num: '' }).replace(/\d+/, '#'), dataIndex: 'version_number', key: 'version_number', render: (v: number) => <Tag color="blue">v{v}</Tag> },
              { title: t('gradeConversion.versions.changedBy'), dataIndex: 'changed_by_name', key: 'changed_by_name', render: (v: string) => v || '-' },
              { title: t('senateDecisions.title'), dataIndex: 'senate_decision_ref', key: 'senate_decision_ref', render: (v: string) => v ? <Tag color="purple">{v}</Tag> : '-' },
              { title: t('gradeConversion.versions.date'), dataIndex: 'created_at', key: 'created_at', render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
              {
                title: '',
                key: 'view',
                render: (_: any, row: any) => (
                  <Button type="link" onClick={async () => {
                    try {
                      const detail = await getSchemeVersion(schemeVersionSchemeId!, row.id);
                      setSchemeVersionDetail(detail);
                    } catch { /* ignore */ }
                  }}>
                    {t('gradeConversion.versions.viewRules')}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Modal>

      {/* ECTS-IKU Version History Modal */}
      <Modal
        title={`ECTS-IKU ${t('gradeConversion.versions.title')}`}
        open={ectsIkuVersionsModal}
        onCancel={() => { setEctsIkuVersionsModal(false); setEctsIkuVersionDetail(null); setEctsIkuVersionsList([]); }}
        footer={<Button onClick={() => { setEctsIkuVersionsModal(false); setEctsIkuVersionDetail(null); setEctsIkuVersionsList([]); }}>{t('gradeConversion.versions.close')}</Button>}
        width={700}
        confirmLoading={ectsIkuVersionLoading}
      >
        {ectsIkuVersionDetail ? (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Button type="link" onClick={() => setEctsIkuVersionDetail(null)} style={{ padding: 0 }}>
                ← {t('gradeConversion.versions.title')}
              </Button>
              <Tag style={{ marginLeft: 8 }} color="green">{t('gradeConversion.versions.versionNumber', { num: ectsIkuVersionDetail.version_number })}</Tag>
            </div>
            <Table
              size="small"
              dataSource={ectsIkuVersionDetail.mappings_snapshot || []}
              pagination={false}
              rowKey={(r: any, i?: number) => r.id ?? i ?? Math.random()}
              columns={[
                { title: t('gradeConversion.columns.ects'), dataIndex: 'ects_grade', key: 'ects_grade', render: (v: string) => <Tag color={ECTS_COLORS[v] || 'default'}>{v}</Tag> },
                { title: t('gradeConversion.columns.ikuGrade'), dataIndex: 'iku_grade', key: 'iku_grade', render: (v: string) => <Tag color="geekblue">{v}</Tag> },
              ]}
            />
          </div>
        ) : (
          <Table
            size="small"
            dataSource={ectsIkuVersionsList}
            pagination={false}
            loading={ectsIkuVersionLoading}
            rowKey="id"
            locale={{ emptyText: t('gradeConversion.versions.noVersions') }}
            columns={[
              { title: t('gradeConversion.versions.versionNumber', { num: '' }).replace(/\d+/, '#'), dataIndex: 'version_number', key: 'version_number', render: (v: number) => <Tag color="green">v{v}</Tag> },
              { title: t('gradeConversion.versions.changedBy'), dataIndex: 'changed_by_name', key: 'changed_by_name', render: (v: string) => v || '-' },
              { title: t('gradeConversion.versions.date'), dataIndex: 'created_at', key: 'created_at', render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
              {
                title: '',
                key: 'view',
                render: (_: any, row: any) => (
                  <Button type="link" onClick={async () => {
                    try {
                      const detail = await getEctsIkuVersion(row.id);
                      setEctsIkuVersionDetail(detail);
                    } catch { /* ignore */ }
                  }}>
                    {t('gradeConversion.versions.viewRules')}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Modal>

      {/* Senate Decisions Drawer */}
      <Drawer
        title={t('senateDecisions.title')}
        placement="right"
        size="large"
        onClose={() => setSenateDrawerVisible(false)}
        open={senateDrawerVisible}
      >
        {!currentScheme ? (
          <Empty description={t('gradeConversion.selectSchemeFirst') || 'Önce bir scheme seçin'} />
        ) : senateLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>
        ) : senateDecisions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Typography.Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5, display: 'block', padding: '0 16px' }}>
                {t('senateDecisions.noDecisions')}
              </Typography.Text>
            }
          >
            <Button type="primary" size="small" onClick={() => { setSenateDrawerVisible(false); navigate('/senate-decisions'); }}>
              {t('senateDecisions.title')} &rarr;
            </Button>
          </Empty>
        ) : (
          <Collapse
            accordion
            size="small"
            items={senateDecisions.map((item: any) => ({
              key: String(item.id),
              label: (
                <Space>
                  <Typography.Text strong>{item.reference_no}</Typography.Text>
                  <Typography.Text>— {item.title}</Typography.Text>
                  {item.university_name && <Tag color="purple">{item.university_name}</Tag>}
                </Space>
              ),
              children: (
                <div>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space wrap>
                      <Typography.Text type="secondary">
                        {item.decision_date ? new Date(item.decision_date).toLocaleDateString() : ''}
                      </Typography.Text>
                      {item.faculty_name && <Tag color="blue">{item.faculty_name}</Tag>}
                      {item.department_name && <Tag>{item.department_name}</Tag>}
                    </Space>
                    {item.summary && <Typography.Text>{item.summary}</Typography.Text>}
                    {item.original_filename && (
                      <Button size="small" icon={<DownloadOutlined />} href={`/api/senate-decisions/${item.id}/file`} download={item.original_filename}>
                        {item.original_filename}
                      </Button>
                    )}
                    <Divider style={{ margin: '4px 0' }} />
                    <Typography.Text strong>{t('gradeConversion.versions.linkVersion') || 'Link to version:'}</Typography.Text>
                    <Select
                      placeholder={t('gradeConversion.versions.selectVersion') || 'Select version...'}
                      allowClear
                      value={(() => {
                        const vid = Object.keys(versionDecisionLinks).find(k => versionDecisionLinks[Number(k)] === item.id);
                        return vid ? Number(vid) : undefined;
                      })()}
                      style={{ width: '100%' }}
                      loading={loadingVersionLink !== null}
                      onChange={(versionId) => handleLinkVersion(versionId, item.id)}
                      onClick={(e) => e.stopPropagation()}
                      onDropdownVisibleChange={async (open) => {
                        if (open && currentScheme) {
                          try {
                            const list = await getSchemeVersions(currentScheme.id);
                            setSchemeVersionsList(list || []);
                            const links: Record<number, number | null> = {};
                            (list || []).forEach((v: any) => {
                              links[v.id] = v.senate_decision_id;
                            });
                            setVersionDecisionLinks(links);
                          } catch { /* ignore */ }
                        }
                      }}
                    >
                      {schemeVersionsList.map((v: any) => (
                        <Select.Option key={v.id} value={v.id}>
                          <Space>
                            <Tag color="blue">v{v.version_number}</Tag>
                            {versionDecisionLinks[v.id] === item.id
                              ? <Tag color="green">{t('gradeConversion.decision.linked') || 'Linked'}</Tag>
                              : versionDecisionLinks[v.id]
                                ? <Tag color="orange">linked to other</Tag>
                                : <Tag>no link</Tag>
                            }
                            {v.senate_decision_ref && <Typography.Text type="secondary">{v.senate_decision_ref}</Typography.Text>}
                          </Space>
                        </Select.Option>
                      ))}
                    </Select>
                  </Space>
                </div>
              ),
            }))}
          />
        )}
      </Drawer>
    </div>
  );
};

export default GradeConversionPage;
