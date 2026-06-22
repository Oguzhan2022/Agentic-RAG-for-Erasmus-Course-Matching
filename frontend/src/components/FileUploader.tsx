import { Upload, message } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { UploadFile } from 'antd';

const { Dragger } = Upload;

interface FileUploaderProps {
  fileList: UploadFile[];
  onChange: (files: UploadFile[]) => void;
}

export default function FileUploader({ fileList, onChange }: FileUploaderProps) {
  const { t } = useTranslation();
  return (
    <Dragger
      multiple
      accept=".pdf,.txt"
      fileList={fileList}
      beforeUpload={(file) => {
        const isPdfOrTxt = file.type === 'application/pdf' || file.type === 'text/plain' || 
                          file.name.endsWith('.pdf') || file.name.endsWith('.txt');
        if (!isPdfOrTxt) {
          message.error(t('fileUploader.errorType', { name: file.name }));
          return Upload.LIST_IGNORE;
        }
        const isLt15M = file.size / 1024 / 1024 <= 15;
        if (!isLt15M) {
          message.error(t('upload.fileLimitError', 'Dosya boyutu en fazla 15 MB olmalıdır!'));
          return Upload.LIST_IGNORE;
        }
        return false;
      }}
      onChange={(info) => onChange(info.fileList)}
      onRemove={(file) => onChange(fileList.filter(f => f.uid !== file.uid))}
      style={{ borderRadius: 10 }}
    >
      <div style={{ padding: '24px 0' }}>
        <CloudUploadOutlined style={{
          fontSize: 40,
          color: '#c0392b',
          marginBottom: 12,
          display: 'block',
        }} />
        <p style={{
          fontSize: 15,
          fontWeight: 500,
          color: '#1a1a1a',
          margin: '0 0 4px',
        }}>
          {t('fileUploader.title')}
        </p>
        <p style={{
          fontSize: 12,
          color: '#999',
          margin: 0,
        }}>
          {t('fileUploader.subtitle')}
        </p>
      </div>
    </Dragger>
  );
}
