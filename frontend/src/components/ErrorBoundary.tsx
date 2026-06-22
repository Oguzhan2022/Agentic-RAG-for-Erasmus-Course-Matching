import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Result, Button, Typography } from 'antd';

const { Text } = Typography;

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          height: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#f0f2f5'
        }}>
          <Result
            status="error"
            title="Something went wrong"
            subTitle="The application encountered an unexpected error. Please try refreshing the page."
            extra={[
              <Button type="primary" key="refresh" onClick={() => window.location.reload()}>
                Refresh Page
              </Button>,
              <Button key="home" onClick={() => window.location.href = '/'}>
                Go to Home
              </Button>,
            ]}
          >
            {this.state.error && (
              <div style={{ textAlign: 'left', background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #ffa39e' }}>
                <Text type="danger" code>{this.state.error.toString()}</Text>
              </div>
            )}
          </Result>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
