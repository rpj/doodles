import React from 'react';
import { useRouter } from 'next/router';
import styles from '../styles/Pagination.module.css';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange?: (page: number) => void; // Keep for backward compatibility but make optional
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const router = useRouter();

  const handlePageChange = (page: number) => {
    if (onPageChange) {
      // Backward compatibility
      onPageChange(page);
    } else {
      // Use URL navigation
      const query = { ...router.query };
      if (page === 1) {
        delete query.page;
      } else {
        query.page = page.toString();
      }
      router.push({
        pathname: router.pathname,
        query,
      });
    }
  };
  const renderPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
      pages.push(
        <button
          key={1}
          onClick={() => handlePageChange(1)}
          className={styles.pageButton}
        >
          1
        </button>
      );
      if (startPage > 2) {
        pages.push(<span key="ellipsis1" className={styles.ellipsis}>...</span>);
      }
    }
    
    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <button
          key={i}
          onClick={() => handlePageChange(i)}
          className={`${styles.pageButton} ${currentPage === i ? styles.active : ''}`}
          disabled={currentPage === i}
        >
          {i}
        </button>
      );
    }
    
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push(<span key="ellipsis2" className={styles.ellipsis}>...</span>);
      }
      pages.push(
        <button
          key={totalPages}
          onClick={() => handlePageChange(totalPages)}
          className={styles.pageButton}
        >
          {totalPages}
        </button>
      );
    }
    
    return pages;
  };
  
  if (totalPages <= 1) {
    return null;
  }
  
  return (
    <div className={styles.pagination}>
      <button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={`${styles.navButton} ${currentPage === 1 ? styles.disabled : ''}`}
      >
        ← Previous
      </button>
      
      <div className={styles.pageNumbers}>
        {renderPageNumbers()}
      </div>
      
      <button
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={`${styles.navButton} ${currentPage === totalPages ? styles.disabled : ''}`}
      >
        Next →
      </button>
    </div>
  );
}