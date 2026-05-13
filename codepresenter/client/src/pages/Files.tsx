import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { 
  FileText, 
  RefreshCw, 
  Folder, 
  Menu
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { FilesManager } from '@/components/layout/FilesManager';

interface FileInfo {
  name: string;
  path: string;
  size: number;
  type: string;
  uploaded: string;
}

export default function Files() {
  return (
    <div className="p-4">
      {/* Only render FilesManager, remove upload button and ArrowUp icon */}
      <FilesManager />
    </div>
  );
} 