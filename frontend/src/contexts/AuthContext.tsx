import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authMe } from '../api/client';

interface UserRole {
  role: string;
  department_id?: number;
  department_name?: string;
  department_code?: string;
  faculty_id?: number;
  faculty_code?: string;
}

interface User {
  eid: string;
  displayName: string;
  email: string;
  roles: UserRole[];
  is_admin: boolean;
  needs_cats_link?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  activeDepartment: string | null;
  setActiveDepartment: (dept: string | null) => void;
  login: (user: User) => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
  tempToken: string | null;
  setTempToken: (token: string | null) => void;
  hasRole: (roleName: string) => boolean;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  activeDepartment: null,
  setActiveDepartment: () => {},
  login: () => {},
  logout: () => {},
  checkAuth: async () => {},
  tempToken: null,
  setTempToken: () => {},
  hasRole: () => false,
  isSuperAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDepartment, setActiveDepartmentState] = useState<string | null>(localStorage.getItem('activeDept'));
  const [tempToken, setTempToken] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const setActiveDepartment = (dept: string | null) => {
    setActiveDepartmentState(dept);
    if (dept) {
      localStorage.setItem('activeDept', dept);
    } else {
      localStorage.removeItem('activeDept');
    }
  };

  const checkAuth = useCallback(async () => {
    try {
      const userData = await authMe();
      setUser(userData);

      // Set active department based on role
      const savedDept = localStorage.getItem('activeDept');
      if (!savedDept) {
        const firstDept = userData.roles.find((r: UserRole) => r.department_code)?.department_code;
        if (firstDept) setActiveDepartment(firstDept);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = (userData: User) => {
    queryClient.clear();
    setUser(userData);
    const savedDept = localStorage.getItem('activeDept');
    if (!savedDept) {
      const firstDept = userData.roles.find((r: UserRole) => r.department_code)?.department_code;
      if (firstDept) setActiveDepartment(firstDept);
    }
  };

  const logout = () => {
    queryClient.clear();
    setUser(null);
    setActiveDepartment(null);
    setTempToken(null);
  };

  const hasRole = useCallback((roleName: string) => {
    return user?.roles.some(r => r.role === roleName) ?? false;
  }, [user]);

  const isSuperAdmin = useMemo(() => {
    return user?.roles.some(r => r.role === 'super_admin') ?? false;
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, loading, activeDepartment, setActiveDepartment,
      login, logout, checkAuth,
      tempToken, setTempToken,
      hasRole, isSuperAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
