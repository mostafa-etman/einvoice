'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { XiraLogo } from '@/components/brand/xira-logo';
import { useTheme } from '@/components/theme-provider';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  Drawer,
  DropdownMenu,
  EmptyState,
  Field,
  FilterBar,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Progress,
  Radio,
  Select,
  Skeleton,
  StatCard,
  Switch,
  Table,
  Tabs,
  Textarea,
  Tooltip,
  useToast,
} from '@/components/ui';
import { formatCompact, formatPercent } from '@/lib/format-number';
import { formatDateDisplay, formatEtaDate } from '@/lib/format-date';

function ToastDemo() {
  const { push } = useToast();
  return (
    <div className="flex flex-wrap gap-token-sm">
      <Button
        size="sm"
        onClick={() => push({ kind: 'success', title: 'Saved', description: 'Draft stored.' })}
      >
        Success toast
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={() => push({ kind: 'error', title: 'Failed', description: 'Request rejected.' })}
      >
        Error toast
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => push({ kind: 'warn', title: 'Late submission' })}
      >
        Warn toast
      </Button>
    </div>
  );
}

export function UiGallery() {
  const locale = useLocale();
  const { theme, toggleTheme } = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState('one');
  const [on, setOn] = useState(true);
  const [page, setPage] = useState(1);
  const [chip, setChip] = useState('all');

  return (
    <div className="flex flex-col gap-token-xl pb-token-2xl">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'Dev', href: '#' }, { label: 'UI' }]} />}
        title="XIRA primitives"
        subtitle="P1 gallery — compare with XIRA-DESIGN-DEMO.html"
        actions={
          <Button variant="secondary" onClick={toggleTheme} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Brand</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-token-lg">
          <div className="rounded-md bg-navy p-token-md">
            <XiraLogo variant="on-dark" />
          </div>
          <div className="rounded-md border border-border bg-on-dark p-token-md">
            <XiraLogo variant="on-light" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center gap-token-sm">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button aria-label="Add" iconStart={<span>+</span>} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form controls</CardTitle>
        </CardHeader>
        <CardBody className="grid max-w-xl gap-token-sm">
          <Input label="Email" placeholder="name@company.com" required />
          <Input label="Error" error="Required field" defaultValue="" />
          <Textarea label="Notes" hint="Optional" />
          <Select label="Environment">
            <option>Sandbox</option>
            <option>Production</option>
          </Select>
          <Field label="Options">
            <div className="flex flex-col gap-token-sm">
              <Checkbox label="Remember me" defaultChecked />
              <Radio name="env" label="Sandbox" defaultChecked />
              <Radio name="env" label="Production" />
              <Switch checked={on} onCheckedChange={setOn} label="Notifications" />
            </div>
          </Field>
        </CardBody>
      </Card>

      <div className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Documents" value="1,284" tone="brand" delta={{ direction: 'up', label: '12.4%' }} />
        <StatCard label="Submitted" value="1,197" tone="teal" delta={{ direction: 'up', label: '98.9%' }} />
        <StatCard label="Pending" value="73" tone="warning" delta={{ direction: 'flat', label: 'Queue' }} />
        <StatCard label="Rejected" value="14" tone="danger" delta={{ direction: 'down', label: 'Review' }} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-token-sm">
          <Badge variant="draft">Draft</Badge>
          <Badge variant="signed">Signed</Badge>
          <Badge variant="submitted">Submitted</Badge>
          <Badge variant="valid">Valid</Badge>
          <Badge variant="invalid">Invalid</Badge>
          <Badge variant="cancelled">Cancelled</Badge>
          <Badge variant="rejected">Rejected</Badge>
          <Badge variant="neutral">Neutral</Badge>
        </CardBody>
      </Card>

      <FilterBar
        search=""
        onSearchChange={() => undefined}
        chips={[
          { id: 'all', label: 'All', count: 1284, active: chip === 'all', onClick: () => setChip('all') },
          { id: 'draft', label: 'Draft', count: 42, active: chip === 'draft', onClick: () => setChip('draft') },
        ]}
        onReset={() => setChip('all')}
      />

      <Table
        caption="Sample documents"
        columns={[
          { id: 'id', header: 'ID', cell: (r) => r.id },
          { id: 'name', header: 'Receiver', cell: (r) => r.name },
          { id: 'status', header: 'Status', cell: (r) => <Badge variant={r.status}>{r.status}</Badge> },
          { id: 'total', header: 'Total', align: 'end', cell: (r) => r.total },
        ]}
        rows={[
          { id: 'INV-01284', name: 'Al-Noor', status: 'valid' as const, total: '45,200' },
          { id: 'INV-01283', name: 'Al-Salam', status: 'submitted' as const, total: '12,850' },
        ]}
        getRowId={(r) => r.id}
      />
      <Pagination page={page} pageCount={8} pageSize={50} onPageChange={setPage} onPageSizeChange={() => undefined} />

      <Card>
        <CardHeader>
          <CardTitle>Overlays</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-token-sm">
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Confirm
          </Button>
          <DropdownMenu
            label="Actions"
            items={[
              { id: 'edit', label: 'Edit', onSelect: () => undefined },
              { id: 'delete', label: 'Delete', danger: true, onSelect: () => undefined },
            ]}
          />
          <Tooltip content="Notification bell">
            <Button variant="ghost" size="sm" aria-label="Notifications">
              Bell
            </Button>
          </Tooltip>
          <CopyButton value="tenant-id-demo" />
          <ToastDemo />
        </CardBody>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'one', label: 'One', panel: <p className="text-token-sm">Panel one</p> },
          { id: 'two', label: 'Two', panel: <p className="text-token-sm">Panel two</p> },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>States</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-token-md">
          <Progress value={75} label="Activation" />
          <Progress label="Indeterminate" />
          <Skeleton />
          <Skeleton variant="rect" />
          <EmptyState
            title="No documents yet"
            description="Create the first document or import a CSV file."
            action={{ label: 'New document', onClick: () => undefined }}
            secondaryAction={{ label: 'Import CSV', onClick: () => undefined }}
          />
          <p className="text-token-sm text-foreground-muted">
            {formatDateDisplay('2026-09-01', locale)} · ETA {formatEtaDate('2026-09-01T12:00:00Z')} ·{' '}
            {formatPercent(0.124)} · {formatCompact(1284)}
          </p>
        </CardBody>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Sample modal" description="Focus trap + Escape">
        <Input label="Name" />
      </Modal>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Sample drawer">
        <p className="text-token-sm text-foreground-muted">Opens from the inline end.</p>
      </Drawer>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        danger
        typedConfirmation="DELETE"
        description="Type DELETE to confirm."
      />
    </div>
  );
}
