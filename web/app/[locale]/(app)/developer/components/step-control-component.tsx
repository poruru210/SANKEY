import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle } from 'lucide-react';

// カスタムCSS（枠線のみ点滅）
const pulsingBorderStyle = `
  @keyframes border-pulse {
    0%, 100% {
      border-color: var(--stepper-inprogress-pulse-border-color-half-opacity);
    }
    50% {
      border-color: var(--stepper-inprogress-pulse-border-color);
    }
  }
`;

// StepControl コンポーネントの型定義
interface StepControlProps {
  id: string | number;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  status?: 'pending' | 'in-progress' | 'completed';
  children: React.ReactNode;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
}

// Helper function to provide all style properties for the status circle
const getStatusStyleProperties = (status: StepControlProps['status']): React.CSSProperties => {
  switch (status) {
    case 'completed':
      return {
        backgroundColor: 'var(--stepper-completed-bg)',
        color: 'var(--stepper-completed-text)',
        borderColor: 'var(--stepper-completed-bg)', // Border same as background for filled effect
        borderWidth: '2px',
        borderStyle: 'solid',
      };
    case 'in-progress':
      return {
        backgroundColor: 'var(--stepper-inprogress-bg)',
        color: 'var(--stepper-inprogress-text)',
        borderColor: 'var(--stepper-inprogress-border)',
        borderWidth: '2px',
        borderStyle: 'solid',
      };
    case 'pending':
      return {
        backgroundColor: 'var(--stepper-pending-bg)',
        color: 'var(--stepper-pending-text)',
        borderColor: 'var(--stepper-pending-border)',
        borderWidth: '2px',
        borderStyle: 'solid',
      };
    default:
      return {};
  }
};

// StepControl コンポーネント
export const StepControl: React.FC<StepControlProps> = ({
                                                          id,
                                                          title,
                                                          description,
                                                          icon,
                                                          status = 'pending',
                                                          children,
                                                          defaultExpanded = false,
                                                          onToggle,
                                                        }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    onToggle?.(newExpanded);
  };

  const getStatusIcon = (status: StepControlProps['status'], stepId: string | number) => {
    switch (status) {
      case 'completed':
        // Removed text-white for color inheritance
        return <CheckCircle className="w-5 h-5" />;
      default:
        // Removed text-white for color inheritance
        return <span className="font-bold text-sm">{stepId}</span>;
    }
  };

  return (
      <>
        <style>{pulsingBorderStyle}</style>
        <div
            className={`border-2 rounded-lg overflow-hidden transition-all duration-300`}
            style={
              status === 'in-progress'
                  ? {
                    animation: 'border-pulse 2s ease-in-out infinite',
                    borderColor: 'var(--stepper-inprogress-pulse-border-color)'
                  }
                  : {
                    borderColor: 'var(--stepper-inner-border-color)'
                  }
            }
        >
          {/* Step Header */}
          <div
              className="p-4 cursor-pointer hover:bg-emerald-500/10 transition-colors"
              onClick={handleToggle}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0 transition-all duration-300`}
                    style={getStatusStyleProperties(status)}
                >
                  {getStatusIcon(status, id)}
                </div>
                {icon && (
                    <div className="text-emerald-400">
                      {icon}
                    </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold theme-text-primary text-sm sm:text-base truncate">{title}</h3>
                  {description && (
                      <p className="text-xs sm:text-sm text-gray-400 mt-0.5 line-clamp-1 sm:line-clamp-none">{description}</p>
                  )}
                </div>
              </div>
              <div className="ml-4 flex-shrink-0">
                {expanded ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </div>
          </div>

          {/* Step Content */}
          {expanded && (
              <div
                  className="border-t p-4 sm:p-6" // Kept padding and border-t for top border
                  style={{
                    backgroundColor: 'var(--card-bg)',
                    borderColor: 'var(--stepper-inner-border-color)', // Updated border color
                    color: 'var(--stepper-content-text)'              // New base text color for content
                  }}
              >
                {children}
              </div>
          )}
        </div>
      </>
  );
};

// StepGroup コンポーネント（複数のStepをグループ化）
interface StepGroupProps {
  children: React.ReactNode;
  className?: string;
}

export const StepGroup: React.FC<StepGroupProps> = ({
                                                      children,
                                                      className = ''
                                                    }) => {
  return (
      <div className={`space-y-4 ${className}`}>
        {children}
      </div>
  );
};